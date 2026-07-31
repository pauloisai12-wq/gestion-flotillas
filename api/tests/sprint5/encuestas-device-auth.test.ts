// Guard de /api/v1/encuestas/*: la única barrera entre internet y la ingesta.
// Se prueba el middleware aislado (prisma mockeado) porque lo que importa aquí
// no es el HTTP sino el veredicto: cualquier ruta que no termine en 401 con una
// key ausente, mal formada, desconocida o revocada deja entrar payloads anónimos.
//
// También se fija el hash: middleware y CLIs de alta comparten
// hashEncuestasDeviceKey, y si dejara de producir el mismo digest para la misma
// key, ningún dispositivo ya dado de alta volvería a autenticar.

import type { NextFunction, Request, Response } from 'express';
import { createHash, createHmac } from 'crypto';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El middleware arrastra prisma por su import; no debe abrir conexiones reales.
const findUnique = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/prisma', () => ({
  default: { encuestaDispositivo: { findUnique, update } },
}));
vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { encuestasDeviceAuthMiddleware } from '../../src/middlewares/encuestasDeviceAuthMiddleware';
import { hashEncuestasDeviceKey } from '../../src/lib/encuestasKeyHash';
import { AppError } from '../../src/middlewares/errorHandler';

const KEY = 'KUeS0oQpZ8n-jL3xW1r5tYbVhA2cD4fG6iJ8kM0oP2q';

const DISPOSITIVO = {
  id: 7,
  identificador: 'encuestador-01',
  keyHash: 'da-igual-el-valor',
  activo: true,
  lastUsedAt: null,
};

function crearContexto(authorization?: string) {
  const req = { headers: authorization ? { authorization } : {} } as unknown as Request;
  const res = {} as Response;
  const next: Mock = vi.fn();
  return { req, res, next };
}

/** Ejecuta el guard con el `next` mockeado (que no es un NextFunction tipado). */
function ejecutar(req: Request, res: Response, next: Mock): Promise<void> {
  return encuestasDeviceAuthMiddleware(req, res, next as unknown as NextFunction);
}

/** Desempaqueta el error con el que se llamó a next(). */
function errorDe(next: Mock): AppError {
  expect(next).toHaveBeenCalledTimes(1);
  const arg = next.mock.calls[0][0];
  expect(arg).toBeInstanceOf(AppError);
  return arg as AppError;
}

function esperar401(next: Mock) {
  const err = errorDe(next);
  expect(err.statusCode).toBe(401);
  expect(err.code).toBe('UNAUTHORIZED');
  return err;
}

describe('encuestasDeviceAuthMiddleware — rechazos', () => {
  it('sin header Authorization → 401 y no consulta la BD', async () => {
    const { req, res, next } = crearContexto();

    await ejecutar(req, res, next);

    expect(esperar401(next).message).toBe('API key requerida');
    expect(req.encuestaDevice).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('header con formato no Bearer → 401 y no consulta la BD', async () => {
    const { req, res, next } = crearContexto(`Basic ${KEY}`);

    await ejecutar(req, res, next);

    expect(esperar401(next).message).toBe('Formato inválido. Use: Bearer <api_key>');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('key desconocida (sin fila) → 401', async () => {
    findUnique.mockResolvedValue(null);
    const { req, res, next } = crearContexto(`Bearer ${KEY}`);

    await ejecutar(req, res, next);

    expect(esperar401(next).message).toBe('API key inválida o revocada');
    expect(req.encuestaDevice).toBeUndefined();
    // El lookup va por el HASH, nunca por la key en claro.
    expect(findUnique).toHaveBeenCalledWith({ where: { keyHash: hashEncuestasDeviceKey(KEY) } });
  });

  it('dispositivo revocado (activo:false) → 401 aunque la key sea correcta', async () => {
    findUnique.mockResolvedValue({ ...DISPOSITIVO, activo: false });
    const { req, res, next } = crearContexto(`Bearer ${KEY}`);

    await ejecutar(req, res, next);

    expect(esperar401(next).message).toBe('API key inválida o revocada');
    expect(req.encuestaDevice).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('encuestasDeviceAuthMiddleware — key válida', () => {
  it('deja pasar y publica req.encuestaDevice (solo id + identificador)', async () => {
    findUnique.mockResolvedValue(DISPOSITIVO);
    update.mockResolvedValue({ ...DISPOSITIVO, lastUsedAt: new Date() });
    const { req, res, next } = crearContexto(`Bearer ${KEY}`);

    await ejecutar(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.encuestaDevice).toEqual({ id: 7, identificador: 'encuestador-01' });
  });

  it('estampa lastUsedAt', async () => {
    findUnique.mockResolvedValue(DISPOSITIVO);
    update.mockResolvedValue(DISPOSITIVO);
    const { req, res, next } = crearContexto(`Bearer ${KEY}`);

    await ejecutar(req, res, next);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('si el UPDATE de lastUsedAt falla, el request YA pasó (no bloquea ni rompe)', async () => {
    findUnique.mockResolvedValue(DISPOSITIVO);
    update.mockRejectedValue(new Error('BD no disponible'));
    const { req, res, next } = crearContexto(`Bearer ${KEY}`);

    await ejecutar(req, res, next);

    // next() ya corrió sin esperar al update: la marca de uso es best-effort.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();

    // Drenar microtasks para que el rechazo se resuelva dentro del test: si el
    // .catch() del middleware desapareciera, esto sería un unhandledRejection.
    await Promise.resolve();
    await Promise.resolve();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.encuestaDevice).toEqual({ id: 7, identificador: 'encuestador-01' });
  });
});

describe('hashEncuestasDeviceKey', () => {
  const pepperOriginal = process.env.ENCUESTAS_KEY_PEPPER;

  beforeEach(() => {
    delete process.env.ENCUESTAS_KEY_PEPPER;
  });

  afterEach(() => {
    if (pepperOriginal === undefined) delete process.env.ENCUESTAS_KEY_PEPPER;
    else process.env.ENCUESTAS_KEY_PEPPER = pepperOriginal;
  });

  it('sin pepper es sha256 hex de la key', () => {
    const esperado = createHash('sha256').update(KEY).digest('hex');

    expect(hashEncuestasDeviceKey(KEY)).toBe(esperado);
    expect(hashEncuestasDeviceKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('con pepper es HMAC-SHA256 y difiere del sha256 pelón', () => {
    // El pepper se lee de process.env en cada llamada (no al importar), así que
    // el cambio surte efecto sin re-importar el módulo ni env.ts.
    process.env.ENCUESTAS_KEY_PEPPER = 'pepper-de-prueba';
    const esperado = createHmac('sha256', 'pepper-de-prueba').update(KEY).digest('hex');

    expect(hashEncuestasDeviceKey(KEY)).toBe(esperado);
    expect(hashEncuestasDeviceKey(KEY)).not.toBe(createHash('sha256').update(KEY).digest('hex'));
  });

  it('es determinista y discrimina keys distintas', () => {
    expect(hashEncuestasDeviceKey(KEY)).toBe(hashEncuestasDeviceKey(KEY));
    expect(hashEncuestasDeviceKey(KEY)).not.toBe(hashEncuestasDeviceKey(`${KEY}x`));
  });
});

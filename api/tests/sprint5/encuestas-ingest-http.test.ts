// La ingesta vista como la ve el teléfono: POST /api/v1/encuestas de punta a
// punta, con el parser de 256 KB del montaje real, el router real, el servicio
// real (sobre un Prisma con memoria) y el errorHandler real. Lo que se fija aquí
// es el CONTRATO de respuesta, que es lo que decide si la app borra el registro
// de su cola local o lo reenvía para siempre:
//
//   201/200 {"idRemoto":"…"} · 409 contenido distinto · 422 validación y versión
//   400 JSON malformado / body que no es objeto · 413 cuerpo enorme · 405 GET.
//
// El guard de dispositivo se prueba aparte (encuestas-device-auth.test.ts); aquí
// se inyecta un req.encuestaDevice ya autenticado, igual que hace el montaje.
// El rate-limit se sustituye por un passthrough: el real habla con Redis y este
// test no debe abrir conexiones.

import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middlewares/rateLimit', () => ({
  rateLimit: (): RequestHandler => (_req, _res, next) => next(),
  getClientIp: () => '127.0.0.1',
}));

const registrado = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/lib/logger', () => ({ logger: registrado }));

/**
 * Prisma con memoria (mismo helper que el test del servicio, aquí detrás del
 * módulo real para que el flujo router → servicio → prisma corra entero): el
 * Map replica el UNIQUE de idLocal y el P2002 que dispara la idempotencia.
 */
const almacen = vi.hoisted(() => {
  type Fila = { id: number; idRemoto: string; idLocal: string; payloadHash: string } & Record<
    string,
    unknown
  >;
  const filas = new Map<string, Fila>();
  let ultimoId = 0;
  return {
    filas,
    limpiar() {
      filas.clear();
      ultimoId = 0;
    },
    async create(args: { data: { idLocal: string } & Record<string, unknown> }) {
      if (filas.has(args.data.idLocal)) {
        // Import diferido: el factory de vi.hoisted corre ANTES de los imports
        // del archivo, así que Prisma solo puede tocarse al invocar el método.
        const { Prisma } = await import('@prisma/client');
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const id = ++ultimoId;
      const fila = {
        ...args.data,
        id,
        idRemoto: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      } as Fila;
      filas.set(args.data.idLocal, fila);
      return fila;
    },
    async findUnique(args: { where: { idLocal: string } }) {
      return filas.get(args.where.idLocal) ?? null;
    },
  };
});
vi.mock('../../src/lib/prisma', () => ({
  default: {
    encuesta: {
      create: (args: Parameters<typeof almacen.create>[0]) => almacen.create(args),
      findUnique: (args: Parameters<typeof almacen.findUnique>[0]) =>
        almacen.findUnique(args),
    },
  },
}));

import encuestasIngestRouter from '../../src/routes/encuestasIngestRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import {
  encuestaCompletaValida,
  encuestaNoElegibleValida,
  type PayloadEncuesta,
} from './fixtures';

const RUTA = '/api/v1/encuestas';

function crearApp() {
  const app = express();
  // Mismo límite que el montaje real (index.ts): es lo que produce el 413.
  app.use(RUTA, express.json({ limit: '256kb' }));
  // En la app real lo puebla encuestasDeviceAuthMiddleware tras validar la key.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.encuestaDevice = { id: 1, identificador: 'test-device' };
    next();
  });
  app.use(RUTA, encuestasIngestRouter);
  app.use(errorHandler);
  return app;
}

function conRespuestas(
  sobre: PayloadEncuesta,
  base: PayloadEncuesta = encuestaCompletaValida(),
): PayloadEncuesta {
  return { ...base, respuestas: { ...(base.respuestas as PayloadEncuesta), ...sobre } };
}

/** Todo lo que se ha escrito al log en el test, serializado. */
function textoDelLog(): string {
  return JSON.stringify(
    [registrado.error, registrado.warn, registrado.info, registrado.debug].map(
      (fn) => fn.mock.calls,
    ),
  );
}

beforeEach(() => {
  almacen.limpiar();
});

describe('POST /api/v1/encuestas — alta', () => {
  it('una encuesta completada válida responde 201 con el idRemoto y nada más', async () => {
    const response = await request(crearApp()).post(RUTA).send(encuestaCompletaValida());

    expect(response.status).toBe(201);
    expect(Object.keys(response.body)).toEqual(['idRemoto']);
    expect(typeof response.body.idRemoto).toBe('string');
    expect(response.body.idRemoto.length).toBeGreaterThan(0);
    expect(almacen.filas.size).toBe(1);
  });

  it('una encuesta noElegible válida también responde 201', async () => {
    const response = await request(crearApp()).post(RUTA).send(encuestaNoElegibleValida());

    expect(response.status).toBe(201);
    expect(typeof response.body.idRemoto).toBe('string');
  });

  it('el reenvío idéntico responde 200 con el MISMO idRemoto y no duplica', async () => {
    const app = crearApp();

    const primera = await request(app).post(RUTA).send(encuestaCompletaValida());
    const reenvio = await request(app).post(RUTA).send(encuestaCompletaValida());

    expect(primera.status).toBe(201);
    expect(reenvio.status).toBe(200); // nunca 204: la app necesita el cuerpo
    expect(reenvio.body.idRemoto).toBe(primera.body.idRemoto);
    expect(almacen.filas.size).toBe(1);
  });

  it('el mismo idLocal con otro contenido responde 409', async () => {
    const app = crearApp();

    await request(app).post(RUTA).send(encuestaCompletaValida());
    const response = await request(app)
      .post(RUTA)
      .send(conRespuestas({ partidoPreferido: 'pri' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(almacen.filas.size).toBe(1);
  });

  it('no filtra al log ni las respuestas ni las coordenadas', async () => {
    const app = crearApp();

    await request(app).post(RUTA).send(encuestaCompletaValida());
    await request(app).post(RUTA).send(conRespuestas({ partidoPreferido: 'pri' })); // 409

    const log = textoDelLog();
    expect(log).not.toContain('morena');
    expect(log).not.toContain('19.432608');
    expect(log).not.toContain('estadoSincronizacion');
    expect(registrado.error).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/encuestas — rechazos', () => {
  it('una versión de cuestionario que el servidor no conoce responde 422 UNSUPPORTED_VERSION', async () => {
    const response = await request(crearApp())
      .post(RUTA)
      .send(encuestaCompletaValida({ versionCuestionario: 2 }));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('UNSUPPORTED_VERSION');
    expect(response.body.details).toEqual({ versionCuestionario: 2 });
    expect(almacen.filas.size).toBe(0);
  });

  it('una versión que ni siquiera es un entero responde 422 VALIDATION_ERROR', async () => {
    const response = await request(crearApp())
      .post(RUTA)
      .send(encuestaCompletaValida({ versionCuestionario: 'x' }));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.issues).toEqual([
      { field: 'versionCuestionario', message: expect.any(String) },
    ]);
  });

  it('un payload inválido responde 422 con las issues, nunca 400', async () => {
    // 400 significa otra cosa en este endpoint (JSON malformado / body no
    // objeto); confundirlos deja a la app sin saber si reintentar.
    const response = await request(crearApp())
      .post(RUTA)
      .send(conRespuestas({ partidoPreferido: 'verde_ecologista' }));

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.issues.length).toBeGreaterThan(0);
    expect(response.body.issues[0].field).toContain('respuestas');
    expect(almacen.filas.size).toBe(0);
  });

  it('un cuerpo por encima de 256 KB responde 413 con el parser real', async () => {
    const response = await request(crearApp())
      .post(RUTA)
      .send(encuestaCompletaValida({ relleno: 'a'.repeat(300 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(almacen.filas.size).toBe(0);
  });

  it('un JSON malformado responde 400 BAD_JSON sin devolver lo recibido', async () => {
    const response = await request(crearApp())
      .post(RUTA)
      .set('Content-Type', 'application/json')
      .send('{ malformado "latitud": 19.432608');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_JSON');
    // El error de body-parser arrastra el cuerpo crudo en `err.body`: ni la
    // respuesta ni el log deben repetirlo.
    expect(response.text).not.toContain('19.432608');
    expect(textoDelLog()).not.toContain('19.432608');
  });

  it('un array en la raíz responde 400: no es una encuesta', async () => {
    const response = await request(crearApp())
      .post(RUTA)
      .send([encuestaCompletaValida()] as unknown as PayloadEncuesta);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(almacen.filas.size).toBe(0);
  });
});

describe('GET /api/v1/encuestas', () => {
  it('responde 405, no 401: la key sirve, el método no', async () => {
    const response = await request(crearApp()).get(RUTA);

    expect(response.status).toBe(405);
    expect(response.body.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('/ping confirma la conexión con 200 {ok:true}', async () => {
    const response = await request(crearApp()).get(`${RUTA}/ping`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

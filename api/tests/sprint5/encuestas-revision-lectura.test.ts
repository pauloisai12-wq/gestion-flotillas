// Lectura de Encuestas Okrean por HTTP (lado REVISOR_QA): quién puede entrar,
// qué sale en el listado, qué cabecera de caché lleva y qué filtros llegan al
// servicio. El servicio va mockeado —su lógica de where/cursor se prueba aparte—
// y prisma no se toca: aquí se fija el CONTRATO del router.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';

// Doble de Prisma con los dos métodos que usa `list`. Casi todo el archivo
// mockea el servicio, pero el último describe corre el `list` REAL contra este
// doble: con `list` mockeado, afirmar que el DTO trae una columna sería
// tautológico (la traería porque la puso la fixture, no el servicio).
const prismaFalso = vi.hoisted(() => ({
  encuesta: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('../../src/lib/prisma', () => ({ default: prismaFalso }));

const registrado = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/lib/logger', () => ({ logger: registrado }));

// Solo se sustituye `list`: el resto del módulo (headers, toCsvRow) sigue siendo
// el real, porque el router lo importa entero con `import * as service`.
const list = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/encuestasRevisionService', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/encuestasRevisionService')>();
  return { ...real, list };
});

import encuestasRouter from '../../src/routes/encuestasRevisionRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { Roles } from '../../src/middlewares/roleMiddleware';
import type { EncuestaDto } from '../../src/services/encuestasRevisionService';

// Sin `role` no se inyecta identidad: es el caso "el JWT no llegó al montaje".
function crearApp(role?: UserRole) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) req.user = { userId: 1, email: 'revisor@flotillas.invalid', role };
    next();
  });
  app.use('/api/encuestas', encuestasRouter);
  app.use(errorHandler);
  return app;
}

const RUTA = '/api/encuestas';

/** Las 14 claves del EncuestaDto (v3 + las dos preferencias v1): ni una más. */
const CLAVES_DTO = [
  'id',
  'idRemoto',
  'folioLocal',
  'encuestador',
  'versionCuestionario',
  'preferenciaElectoral',
  'preferenciaPartido',
  'conoceLalo',
  'partidoPreferido',
  'candidatoPreferido',
  'duracionSegundos',
  'fechaHoraFinalizacion',
  'recibidoEn',
  'ubicacionDisponible',
  'dispositivo',
];

function encuesta(overrides: Partial<EncuestaDto> = {}): EncuestaDto {
  return {
    id: 9,
    idRemoto: '7a1d9c22-1f4e-4f2a-9d3b-5c6e7f8a9b01',
    folioLocal: 'LX-1042',
    encuestador: 'María López',
    versionCuestionario: 3,
    preferenciaElectoral: 'lalo_ximenez',
    preferenciaPartido: 'morena',
    conoceLalo: 'si',
    // Preferencias del contrato v1: NULL en una fila v3.
    partidoPreferido: null,
    candidatoPreferido: null,
    duracionSegundos: 400,
    fechaHoraFinalizacion: new Date('2026-07-30T10:06:40.000Z'),
    recibidoEn: new Date('2026-07-30T10:07:05.000Z'),
    ubicacionDisponible: true,
    dispositivo: { id: 3, identificador: 'encuestador-01' },
    ...overrides,
  };
}

function pagina(data: EncuestaDto[] = [], total = data.length) {
  return { data, pagination: { page: 1, limit: 20, total, totalPages: Math.ceil(total / 20) } };
}

describe('GET /api/encuestas — listado', () => {
  it('devuelve { data, pagination } con el shape del DTO', async () => {
    list.mockResolvedValue(pagina([encuesta()], 41));

    const response = await request(crearApp(Roles.REVISOR_QA)).get(RUTA);

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 1, limit: 20, total: 41, totalPages: 3 });
    expect(Object.keys(response.body.data[0]).sort()).toEqual([...CLAVES_DTO].sort());
    expect(response.body.data[0]).toMatchObject({
      idRemoto: '7a1d9c22-1f4e-4f2a-9d3b-5c6e7f8a9b01',
      encuestador: 'María López',
      versionCuestionario: 3,
      preferenciaElectoral: 'lalo_ximenez',
      preferenciaPartido: 'morena',
      conoceLalo: 'si',
      partidoPreferido: null,
      candidatoPreferido: null,
      // Las fechas viajan serializadas en UTC.
      fechaHoraFinalizacion: '2026-07-30T10:06:40.000Z',
      dispositivo: { id: 3, identificador: 'encuestador-01' },
    });
    // El body crudo del teléfono y su hash no salen del servidor.
    expect(response.body.data[0]).not.toHaveProperty('payloadRaw');
    expect(response.body.data[0]).not.toHaveProperty('payloadHash');
    expect(response.body.data[0]).not.toHaveProperty('estado');
    expect(response.body.data[0]).not.toHaveProperty('elegibilidad');
  });

  it('no cachea: las respuestas políticas no pueden repintarse tras cerrar sesión', async () => {
    list.mockResolvedValue(pagina());

    const response = await request(crearApp(Roles.REVISOR_QA)).get(RUTA);

    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  // validateQuery REEMPLAZA req.query por el objeto parseado, así que si el
  // schema no declarara page/limit, zod los estriparía y parsePagination —que
  // corre después— serviría siempre la página 1 en silencio.
  it('reenvía paginación y filtros al servicio (sin estado)', async () => {
    list.mockResolvedValue(pagina());

    await request(crearApp(Roles.REVISOR_QA)).get(RUTA).query({
      page: '3',
      limit: '10',
      dispositivo: 'encuestador',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    expect(list.mock.calls[0][0]).toEqual({
      page: 3,
      limit: 10,
      dispositivo: 'encuestador',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });

  it('zod estripa un parámetro `estado` sin error (enum de una sola opción)', async () => {
    list.mockResolvedValue(pagina());

    const response = await request(crearApp(Roles.REVISOR_QA)).get(RUTA).query({
      estado: 'completada',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    expect(response.status).toBe(200);
    // El `estado` se estripa en la validación; no llega al servicio.
    expect(list.mock.calls[0][0]).toEqual({
      page: 1,
      limit: 20,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });
});

// Lo que el router no puede demostrar (lo tiene mockeado): que el servicio pide
// a la BD las columnas de las DOS versiones y que su mapeo explícito las deja
// pasar sin colar el body crudo del teléfono.
describe('list — columnas que el servicio pide y devuelve', () => {
  it('selecciona las preferencias de v1 y v3 y no expone el payload crudo', async () => {
    const { list: listReal } = await vi.importActual<
      typeof import('../../src/services/encuestasRevisionService')
    >('../../src/services/encuestasRevisionService');

    prismaFalso.encuesta.findMany.mockResolvedValue([
      {
        ...encuesta({
          versionCuestionario: 1,
          partidoPreferido: 'pri',
          candidatoPreferido: 'irineo_molina',
        }),
        // Si el select volviera a `include`, la fila llegaría con esto dentro.
        payloadRaw: '{"idLocal":"…"}',
      },
    ]);
    prismaFalso.encuesta.count.mockResolvedValue(1);

    const { data } = await listReal({});

    const { select } = prismaFalso.encuesta.findMany.mock.calls[0][0];
    expect(select.partidoPreferido).toBe(true);
    expect(select.candidatoPreferido).toBe(true);
    expect(select.payloadRaw).toBeUndefined();

    // El mapeo explícito arma el DTO clave por clave: ni una de más (payloadRaw
    // venía en la fila) ni una de menos.
    expect(Object.keys(data[0]).sort()).toEqual([...CLAVES_DTO].sort());
    expect(data[0]).toMatchObject({ partidoPreferido: 'pri', candidatoPreferido: 'irineo_molina' });
    expect(data[0]).not.toHaveProperty('payloadRaw');
  });
});

describe('GET /api/encuestas — acceso', () => {
  // El módulo es de REVISOR_QA y de nadie más: ni siquiera ADMIN lo lee, igual
  // que el registro de personas de qa_externa.
  it.each([Roles.EXECUTOR, Roles.ADMIN, Roles.SUP_VEHICLES])(
    'el rol %s recibe 403 y no llega a consultar',
    async (role) => {
      const response = await request(crearApp(role)).get(RUTA);

      expect(response.status).toBe(403);
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('sin usuario autenticado responde 401', async () => {
    const response = await request(crearApp()).get(RUTA);

    expect(response.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('GET /api/encuestas — filtros inválidos', () => {
  it('rechaza una fecha que no sea AAAA-MM-DD con 400', async () => {
    const response = await request(crearApp(Roles.REVISOR_QA))
      .get(RUTA)
      .query({ dateFrom: '01-07-2026' });

    expect(response.status).toBe(400);
    expect(response.body.details).toContainEqual({
      field: 'dateFrom',
      message: 'Usa formato AAAA-MM-DD',
    });
    expect(list).not.toHaveBeenCalled();
  });
});

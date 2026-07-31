// Lectura de Encuestas Okrean por HTTP (lado REVISOR_QA): quién puede entrar,
// qué sale en el listado, qué cabecera de caché lleva y qué filtros llegan al
// servicio. El servicio va mockeado —su lógica de where/cursor se prueba aparte—
// y prisma no se toca: aquí se fija el CONTRATO del router.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';

vi.mock('../../src/lib/prisma', () => ({ default: {} }));

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

/** Las 13 claves del EncuestaDto del contrato: ni una más. */
const CLAVES_DTO = [
  'id',
  'idRemoto',
  'folioLocal',
  'estado',
  'elegibilidad',
  'versionCuestionario',
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
    estado: 'completada',
    elegibilidad: 'elegible',
    versionCuestionario: 1,
    partidoPreferido: 'morena',
    candidatoPreferido: 'lalo_ximenez',
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
      estado: 'completada',
      // Las fechas viajan serializadas en UTC.
      fechaHoraFinalizacion: '2026-07-30T10:06:40.000Z',
      dispositivo: { id: 3, identificador: 'encuestador-01' },
    });
    // El body crudo del teléfono y su hash no salen del servidor.
    expect(response.body.data[0]).not.toHaveProperty('payloadRaw');
    expect(response.body.data[0]).not.toHaveProperty('payloadHash');
  });

  it('no cachea: las respuestas políticas no pueden repintarse tras cerrar sesión', async () => {
    list.mockResolvedValue(pagina());

    const response = await request(crearApp(Roles.REVISOR_QA)).get(RUTA);

    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  // validateQuery REEMPLAZA req.query por el objeto parseado, así que si el
  // schema no declarara page/limit, zod los estriparía y parsePagination —que
  // corre después— serviría siempre la página 1 en silencio.
  it('reenvía paginación y filtros al servicio', async () => {
    list.mockResolvedValue(pagina());

    await request(crearApp(Roles.REVISOR_QA)).get(RUTA).query({
      page: '3',
      limit: '10',
      estado: 'noElegible',
      dispositivo: 'encuestador',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    expect(list.mock.calls[0][0]).toEqual({
      page: 3,
      limit: 10,
      estado: 'noElegible',
      dispositivo: 'encuestador',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
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
  it('rechaza un estado fuera del enum con 400', async () => {
    const response = await request(crearApp(Roles.REVISOR_QA))
      .get(RUTA)
      .query({ estado: 'cancelada' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Parámetros inválidos');
    expect(list).not.toHaveBeenCalled();
  });

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

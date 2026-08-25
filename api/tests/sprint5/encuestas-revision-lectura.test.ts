// Lectura de Encuestas Okrean por HTTP (lado REVISOR_QA): quién puede entrar,
// qué sale en el listado y en el detalle, qué cabecera de caché llevan, qué
// filtros llegan al servicio y cómo se transmite el audio de un segmento. El
// servicio va mockeado —su lógica de where/cursor se prueba aparte— y prisma no
// se toca salvo en el describe final: aquí se fija el CONTRATO del router.
//
// El disco SÍ es real para el stream (un mkdtemp fijado por `vi.hoisted` antes
// de que env.ts lea process.env): el 206 con Range y el 404 por blob ausente
// solo se pueden comprobar con un archivo de verdad detrás.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { UserRole } from '@prisma/client';

// Directorio de audios ANTES de cualquier import: env.ts lee process.env una
// sola vez al cargarse y rutaAbsolutaAudio resuelve contra ese valor.
const dirAudios = await vi.hoisted(async () => {
  const fsm = await import('node:fs');
  const osm = await import('node:os');
  const pathm = await import('node:path');
  const d = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'enc-audio-rev-'));
  process.env.ENCUESTAS_AUDIO_DIR = d;
  return d;
});

// Doble de Prisma con los métodos que usan `list`, `getById` y
// `getAudioParaServir`. Casi todo el archivo mockea el servicio, pero dos
// describes corren esas funciones REALES contra este doble: con el servicio
// mockeado, afirmar que el DTO trae una columna o que el audio se busca acotado
// a su encuesta sería tautológico (lo traería la fixture, no el servicio).
const prismaFalso = vi.hoisted(() => ({
  encuesta: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  encuestaAudio: { findFirst: vi.fn() },
}));
vi.mock('../../src/lib/prisma', () => ({ default: prismaFalso }));

const registrado = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/lib/logger', () => ({ logger: registrado }));

// Solo se sustituyen los tres lectores de BD: el resto del módulo (headers,
// toCsvRow, contentTypeDeAudio) sigue siendo el real, porque el router lo
// importa entero con `import * as service`.
const list = vi.hoisted(() => vi.fn());
const getById = vi.hoisted(() => vi.fn());
const getAudioParaServir = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/encuestasRevisionService', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/encuestasRevisionService')>();
  return { ...real, list, getById, getAudioParaServir };
});

import encuestasRouter from '../../src/routes/encuestasRevisionRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { Roles } from '../../src/middlewares/roleMiddleware';
import type { EncuestaAudioDto, EncuestaDto } from '../../src/services/encuestasRevisionService';

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

/**
 * Las 18 claves del EncuestaDto (v3 + dos campos nuevos v4 + dos preferencias v1
 * + el conteo de audios): ni una más.
 */
const CLAVES_DTO = [
  'id',
  'idRemoto',
  'folioLocal',
  'encuestador',
  'versionCuestionario',
  'preferenciaElectoral',
  'preferenciaElectoralOtro',
  'preferenciaPartido',
  'preferenciaPartidoOtro',
  'conoceLalo',
  'partidoPreferido',
  'candidatoPreferido',
  'duracionSegundos',
  'fechaHoraFinalizacion',
  'recibidoEn',
  'ubicacionDisponible',
  'audiosCount',
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
    preferenciaElectoralOtro: null,
    preferenciaPartido: 'morena',
    preferenciaPartidoOtro: null,
    conoceLalo: 'si',
    // Preferencias del contrato v1: NULL en una fila v3.
    partidoPreferido: null,
    candidatoPreferido: null,
    duracionSegundos: 400,
    fechaHoraFinalizacion: new Date('2026-07-30T10:06:40.000Z'),
    recibidoEn: new Date('2026-07-30T10:07:05.000Z'),
    ubicacionDisponible: true,
    audiosCount: 0,
    dispositivo: { id: 3, identificador: 'encuestador-01' },
    ...overrides,
  };
}

/**
 * La misma encuesta pero como la devuelve Prisma para el listado: con `_count`
 * y SIN el conteo aplanado, que es cosa de toDto. Sin quitarlo, un `audiosCount`
 * que llegara de la fila haría pasar la aserción aunque el mapeo no existiera.
 */
function filaDeListado(overrides: Partial<EncuestaDto> = {}, audios = 0): Record<string, unknown> {
  const fila: Record<string, unknown> = { ...encuesta(overrides), _count: { audios } };
  delete fila.audiosCount;
  return fila;
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

  // El filtro llega como TEXTO: 'false' con z.coerce.boolean() sería `true` y el
  // revisor que pide "sin audio" vería justo las que sí lo tienen.
  it.each([
    ['true', true],
    ['false', false],
  ])('reenvía ?conAudio=%s al servicio como %s', async (crudo, esperado) => {
    list.mockResolvedValue(pagina());

    const response = await request(crearApp(Roles.REVISOR_QA)).get(RUTA).query({ conAudio: crudo });

    expect(response.status).toBe(200);
    expect(list.mock.calls[0][0]).toMatchObject({ conAudio: esperado });
  });

  it('sin ?conAudio el filtro no llega definido (no filtra)', async () => {
    list.mockResolvedValue(pagina());

    await request(crearApp(Roles.REVISOR_QA)).get(RUTA);

    expect(list.mock.calls[0][0].conAudio).toBeUndefined();
  });

  it('rechaza un ?conAudio que no sea true/false con 400', async () => {
    const response = await request(crearApp(Roles.REVISOR_QA)).get(RUTA).query({ conAudio: 'si' });

    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
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
        ...filaDeListado(
          {
            versionCuestionario: 1,
            partidoPreferido: 'pri',
            candidatoPreferido: 'irineo_molina',
          },
          2,
        ),
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
    // El listado pide el CONTEO de audios, nunca las filas.
    expect(select._count).toEqual({ select: { audios: true } });
    expect(select.audios).toBeUndefined();

    // El mapeo explícito arma el DTO clave por clave: ni una de más (payloadRaw
    // venía en la fila) ni una de menos.
    expect(Object.keys(data[0]).sort()).toEqual([...CLAVES_DTO].sort());
    expect(data[0]).toMatchObject({ partidoPreferido: 'pri', candidatoPreferido: 'irineo_molina' });
    expect(data[0]).not.toHaveProperty('payloadRaw');
    // `_count.audios` se aplana a `audiosCount` y el `_count` de Prisma no sale.
    expect(data[0].audiosCount).toBe(2);
    expect(data[0]).not.toHaveProperty('_count');
  });

  it.each([
    [true, { some: {} }],
    [false, { none: {} }],
  ])('conAudio=%s se traduce a un filtro por relación', async (conAudio, esperado) => {
    const { list: listReal } = await vi.importActual<
      typeof import('../../src/services/encuestasRevisionService')
    >('../../src/services/encuestasRevisionService');

    prismaFalso.encuesta.findMany.mockResolvedValue([]);
    prismaFalso.encuesta.count.mockResolvedValue(0);

    await listReal({ conAudio });

    // `some`/`none` (un EXISTS en Postgres), no un conteo traído a RAM. El mismo
    // where alimenta el CSV, así que el archivo nunca trae otro conjunto.
    expect(prismaFalso.encuesta.findMany.mock.calls[0][0].where.audios).toEqual(esperado);
  });

  it('sin conAudio no añade filtro por relación', async () => {
    const { list: listReal } = await vi.importActual<
      typeof import('../../src/services/encuestasRevisionService')
    >('../../src/services/encuestasRevisionService');

    prismaFalso.encuesta.findMany.mockResolvedValue([]);
    prismaFalso.encuesta.count.mockResolvedValue(0);

    await listReal({});

    expect(prismaFalso.encuesta.findMany.mock.calls[0][0].where.audios).toBeUndefined();
  });

  it('v4 con "otro" emite los campos de texto en el DTO', async () => {
    const { list: listReal } = await vi.importActual<
      typeof import('../../src/services/encuestasRevisionService')
    >('../../src/services/encuestasRevisionService');

    prismaFalso.encuesta.findMany.mockResolvedValue([
      {
        ...filaDeListado({
          versionCuestionario: 4,
          preferenciaElectoral: 'otro',
          preferenciaElectoralOtro: 'Candidato independiente',
          preferenciaPartido: 'otro',
          preferenciaPartidoOtro: 'Movimiento alternativo',
        }),
        payloadRaw: '{"idLocal":"…"}',
      },
    ]);
    prismaFalso.encuesta.count.mockResolvedValue(1);

    const { data } = await listReal({});

    // El DTO v4 con "otro" debe exponer los campos de texto sin truncar.
    expect(data[0]).toMatchObject({
      versionCuestionario: 4,
      preferenciaElectoral: 'otro',
      preferenciaElectoralOtro: 'Candidato independiente',
      preferenciaPartido: 'otro',
      preferenciaPartidoOtro: 'Movimiento alternativo',
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

// ─── Detalle ─────────────────────────────────────────────────────────────────

const SHA = 'a'.repeat(64);
const CONTENIDO = Buffer.from('AUDIO-FAKE-BYTES'); // 16 bytes
const RUTA_BLOB = `encuestas-audio/${SHA}.m4a`;
fs.writeFileSync(path.join(dirAudios, `${SHA}.m4a`), CONTENIDO);

afterAll(() => {
  fs.rmSync(dirAudios, { recursive: true, force: true });
});

function audioDto(overrides: Partial<EncuestaAudioDto> = {}): EncuestaAudioDto {
  return {
    id: 3,
    segmento: 'seg1.m4a',
    sha256: SHA,
    tamanoBytes: CONTENIDO.length,
    mimeDeclarado: 'audio/mp4',
    duracionMs: 12_000,
    recibidoEn: new Date('2026-07-30T10:07:05.000Z'),
    url: '/api/encuestas/9/audios/3',
    ...overrides,
  };
}

describe('GET /api/encuestas/:id — detalle', () => {
  it('devuelve el DTO + idLocal + audios, sin cachear', async () => {
    getById.mockResolvedValue({
      ...encuesta({ audiosCount: 1 }),
      idLocal: 'e1-uuid',
      audios: [audioDto()],
    });

    const response = await request(crearApp(Roles.REVISOR_QA)).get(`${RUTA}/9`);

    expect(response.status).toBe(200);
    expect(getById).toHaveBeenCalledWith(9);
    expect(response.body).toMatchObject({
      id: 9,
      idLocal: 'e1-uuid',
      audiosCount: 1,
    });
    expect(response.body.audios).toHaveLength(1);
    expect(response.body.audios[0]).toMatchObject({
      id: 3,
      segmento: 'seg1.m4a',
      sha256: SHA,
      tamanoBytes: 16,
      duracionMs: 12_000,
      // La URL viaja armada por el servidor: el front no compone rutas.
      url: '/api/encuestas/9/audios/3',
    });
    // Dónde vive el blob en el disco del servidor es interno.
    expect(response.body.audios[0]).not.toHaveProperty('ruta');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('un :id no numérico es 400 y no consulta', async () => {
    const response = await request(crearApp(Roles.REVISOR_QA)).get(`${RUTA}/abc`);

    expect(response.status).toBe(400);
    expect(getById).not.toHaveBeenCalled();
  });

  it('una encuesta inexistente es 404', async () => {
    getById.mockResolvedValue(null);

    const response = await request(crearApp(Roles.REVISOR_QA)).get(`${RUTA}/9`);

    expect(response.status).toBe(404);
  });

  it('otro rol recibe 403 y no consulta', async () => {
    const response = await request(crearApp(Roles.ADMIN)).get(`${RUTA}/9`);

    expect(response.status).toBe(403);
    expect(getById).not.toHaveBeenCalled();
  });

  // El orden de registro del router es carga viva: `/:id` declarado antes de
  // `/export.csv` se comería la exportación (parseId('export.csv') → 400).
  it('no se come /export.csv: la exportación sigue respondiendo', async () => {
    const response = await request(crearApp(Roles.REVISOR_QA))
      .head(`${RUTA}/export.csv`)
      .query({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(getById).not.toHaveBeenCalled();
  });
});

// ─── Stream del segmento ─────────────────────────────────────────────────────

describe('GET|HEAD /api/encuestas/:id/audios/:audioId', () => {
  function servible(overrides: Record<string, unknown> = {}) {
    return {
      ruta: RUTA_BLOB,
      mimeDeclarado: null,
      segmento: 'seg1.m4a',
      idLocal: 'e1-uuid',
      ...overrides,
    };
  }

  it('transmite el blob completo y anuncia que acepta rangos', async () => {
    getAudioParaServir.mockResolvedValue(servible());

    const response = await request(crearApp(Roles.REVISOR_QA))
      .get(`${RUTA}/9/audios/3`)
      .buffer(true);

    expect(response.status).toBe(200);
    expect(getAudioParaServir).toHaveBeenCalledWith(9, 3);
    expect(response.headers['content-type']).toBe('audio/mp4');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-length']).toBe(String(CONTENIDO.length));
    // Cacheable en la sesión del revisor (un audio no cambia) pero privado y sin
    // recomprimir por ningún intermediario.
    expect(response.headers['cache-control']).toBe(
      'private, max-age=3600, must-revalidate, no-transform',
    );
    expect(response.headers['vary']).toContain('Cookie');
    expect(response.headers['content-disposition']).toBeUndefined();
  });

  // El mime lo eligió el teléfono: se respeta si es audio/*, si no se cae a
  // audio/mp4 para no servir un text/html interpretable en el origen del portal.
  it.each([
    [null, 'audio/mp4'],
    ['audio/aac', 'audio/aac'],
    ['text/html', 'audio/mp4'],
  ])('mimeDeclarado %s se sirve como %s', async (mimeDeclarado, esperado) => {
    getAudioParaServir.mockResolvedValue(servible({ mimeDeclarado }));

    const response = await request(crearApp(Roles.REVISOR_QA))
      .get(`${RUTA}/9/audios/3`)
      .buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(esperado);
  });

  it('atiende un Range con 206 y solo el tramo pedido', async () => {
    getAudioParaServir.mockResolvedValue(servible());

    const response = await request(crearApp(Roles.REVISOR_QA))
      .get(`${RUTA}/9/audios/3`)
      .set('Range', 'bytes=0-3')
      .buffer(true);

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe(`bytes 0-3/${CONTENIDO.length}`);
    expect(response.headers['content-length']).toBe('4');
  });

  it('?download=1 lo entrega como adjunto con un nombre útil', async () => {
    getAudioParaServir.mockResolvedValue(servible());

    const response = await request(crearApp(Roles.REVISOR_QA))
      .get(`${RUTA}/9/audios/3`)
      .query({ download: '1' })
      .buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('e1-uuid-seg1.m4a');
    // El tipo lo manda el servicio, no la extensión del nombre de descarga:
    // `res.attachment` adivina por extensión y `.m4a` no está en la tabla mime
    // de Express, así que sin el `res.type` posterior la descarga saldría como
    // application/octet-stream.
    expect(response.headers['content-type']).toMatch(/^audio\/mp4/);
  });

  it('HEAD publica las cabeceras sin mover el cuerpo', async () => {
    getAudioParaServir.mockResolvedValue(servible());

    const response = await request(crearApp(Roles.REVISOR_QA)).head(`${RUTA}/9/audios/3`);

    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe(String(CONTENIDO.length));
    expect(response.headers['accept-ranges']).toBe('bytes');
  });

  // Solo el contrato del router: cuando el servicio no devuelve nada (segmento
  // inexistente O de otra encuesta), la respuesta es 404 y no un 500. Que el
  // segmento de otra encuesta NO se encuentre lo prueba el where del servicio,
  // en el describe `getAudioParaServir` del final: aquí el servicio va mockeado.
  it('si el servicio no devuelve el segmento, responde 404', async () => {
    getAudioParaServir.mockResolvedValue(null);

    const response = await request(crearApp(Roles.REVISOR_QA)).get(`${RUTA}/9/audios/3`);

    expect(response.status).toBe(404);
  });

  // Fila en BD sin blob en disco (restauración parcial, borrado manual): 404
  // honesto, no un 500 con la ruta del archivo dentro.
  it('si el blob no está en disco responde 404', async () => {
    getAudioParaServir.mockResolvedValue(
      servible({ ruta: `encuestas-audio/${'b'.repeat(64)}.m4a` }),
    );

    const response = await request(crearApp(Roles.REVISOR_QA)).get(`${RUTA}/9/audios/3`);

    expect(response.status).toBe(404);
  });

  it('un :audioId no numérico es 400 y no consulta', async () => {
    const response = await request(crearApp(Roles.REVISOR_QA)).get(`${RUTA}/9/audios/abc`);

    expect(response.status).toBe(400);
    expect(getAudioParaServir).not.toHaveBeenCalled();
  });

  it('otro rol recibe 403 y no consulta', async () => {
    const response = await request(crearApp(Roles.EXECUTOR)).get(`${RUTA}/9/audios/3`);

    expect(response.status).toBe(403);
    expect(getAudioParaServir).not.toHaveBeenCalled();
  });
});

// ─── Lo que el detalle y el stream le piden REALMENTE a la BD ────────────────
//
// Todo lo de arriba corre con `getById`/`getAudioParaServir` mockeados: sirve
// para fijar el contrato HTTP, pero no puede ver el `where` ni el `select` que
// se mandan a Postgres. Y ahí viven las dos garantías que importan: que el
// segmento se busca acotado a SU encuesta (sin eso, /encuestas/1/audios/7
// serviría el audio de la 7 a quien pida la 1) y que la ruta del blob en disco
// nunca se selecciona. Estas dos las prueba el servicio real contra el doble.

const CLAVES_AUDIO_DTO = [
  'id',
  'segmento',
  'sha256',
  'tamanoBytes',
  'mimeDeclarado',
  'duracionMs',
  'recibidoEn',
  'url',
];

/** Un audio tal como lo devuelve Prisma con el select de `getById`. */
function filaDeAudio(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 3,
    segmento: 'seg1.m4a',
    sha256: SHA,
    tamanoBytes: CONTENIDO.length,
    mimeDeclarado: 'audio/mp4',
    duracionMs: 12_000,
    recibidoEn: new Date('2026-07-30T10:07:05.000Z'),
    ...overrides,
  };
}

async function servicioReal() {
  return vi.importActual<typeof import('../../src/services/encuestasRevisionService')>(
    '../../src/services/encuestasRevisionService',
  );
}

describe('getById — columnas y orden que el servicio pide', () => {
  it('pide el detalle por id con idLocal y los audios ordenados por llegada', async () => {
    const { getById: getByIdReal } = await servicioReal();

    prismaFalso.encuesta.findUnique.mockResolvedValue({
      ...filaDeListado({}, 2),
      idLocal: 'e1-uuid',
      audios: [filaDeAudio(), filaDeAudio({ id: 4, segmento: 'seg2.m4a' })],
    });

    const detalle = await getByIdReal(9);

    const { where, select } = prismaFalso.encuesta.findUnique.mock.calls[0][0];
    expect(where).toEqual({ id: 9 });
    expect(select.idLocal).toBe(true);
    // seg10 llega después de seg2 pero ordena antes por nombre: el orden es el
    // de llegada, con `id` de desempate para que sea estable al milisegundo.
    expect(select.audios.orderBy).toEqual([{ recibidoEn: 'asc' }, { id: 'asc' }]);
    // La ruta del blob en disco NO se selecciona: `audios.map` hace spread de la
    // fila, así que pedirla aquí la publicaría tal cual en el JSON del detalle.
    expect(select.audios.select.ruta).toBeUndefined();
    expect(select.audios.select.sha256).toBe(true);
    // El body crudo del teléfono y su hash tampoco, igual que en el listado.
    expect(select.payloadRaw).toBeUndefined();
    expect(select.payloadHash).toBeUndefined();

    expect(detalle).not.toBeNull();
    expect(Object.keys(detalle!).sort()).toEqual([...CLAVES_DTO, 'idLocal', 'audios'].sort());
    expect(detalle!.idLocal).toBe('e1-uuid');
    expect(detalle!.audiosCount).toBe(2);
    expect(detalle).not.toHaveProperty('_count');
    // Cada segmento sale con su URL armada por el servidor y sin una clave más.
    expect(Object.keys(detalle!.audios[0]).sort()).toEqual([...CLAVES_AUDIO_DTO].sort());
    expect(detalle!.audios.map((a) => a.url)).toEqual([
      '/api/encuestas/9/audios/3',
      '/api/encuestas/9/audios/4',
    ]);
  });

  it('una encuesta inexistente devuelve null, no una fila a medias', async () => {
    const { getById: getByIdReal } = await servicioReal();

    prismaFalso.encuesta.findUnique.mockResolvedValue(null);

    expect(await getByIdReal(9)).toBeNull();
  });
});

describe('getAudioParaServir — el segmento se acota a su encuesta', () => {
  it('busca por id Y encuestaId (la ruta es comprobable, no un id suelto)', async () => {
    const { getAudioParaServir: servirReal } = await servicioReal();

    prismaFalso.encuestaAudio.findFirst.mockResolvedValue({
      ruta: RUTA_BLOB,
      mimeDeclarado: 'audio/mp4',
      segmento: 'seg1.m4a',
      encuesta: { idLocal: 'e1-uuid' },
    });

    const audio = await servirReal(9, 3);

    const { where, select } = prismaFalso.encuestaAudio.findFirst.mock.calls[0][0];
    // ESTA es la protección contra IDOR: con `{ id: 3 }` a secas,
    // GET /api/encuestas/9/audios/3 serviría el segmento aunque fuera de la
    // encuesta 41, y el revisor escucharía a alguien que no está mirando.
    expect(where).toEqual({ id: 3, encuestaId: 9 });
    // Lo mínimo para servir el blob; nada del cuestionario ni del payload.
    expect(select).toEqual({
      ruta: true,
      mimeDeclarado: true,
      segmento: true,
      encuesta: { select: { idLocal: true } },
    });

    // El idLocal se aplana: quien sirve el archivo no recibe la relación entera.
    expect(audio).toEqual({
      ruta: RUTA_BLOB,
      mimeDeclarado: 'audio/mp4',
      segmento: 'seg1.m4a',
      idLocal: 'e1-uuid',
    });
  });

  it('sin fila (inexistente o de otra encuesta) devuelve null', async () => {
    const { getAudioParaServir: servirReal } = await servicioReal();

    prismaFalso.encuestaAudio.findFirst.mockResolvedValue(null);

    expect(await servirReal(9, 3)).toBeNull();
  });
});

// ─── El estático de /uploads no sirve audios ────────────────────────────────
// Gemelo del test de `maintenance-tickets` (tests/sprint3/ticket-private-files.test.ts):
// se comprueba sobre el FUENTE de index.ts porque montar la app entera aquí
// arrastraría env.ts, Redis y los cron jobs. Lo que se está protegiendo es que
// nadie reabra el estático: el nombre del blob ES el sha256, así que servido por
// express.static cualquier usuario autenticado (no solo REVISOR_QA) podría leer
// la voz de un encuestado adivinando —o filtrando— un hash.
describe('/uploads/encuestas-audio queda cerrado al estático', () => {
  it('index.ts monta el 404 explícito y trata la categoría en el guard', async () => {
    const indexSource = await fs.promises.readFile(path.resolve('src/index.ts'), 'utf8');

    expect(indexSource).toContain("'/uploads/encuestas-audio'");
    expect(indexSource).toContain("uploadCategory === 'encuestas-audio'");
  });

  it('la única puerta al audio es la ruta con requireRole([REVISOR_QA])', async () => {
    const routerSource = await fs.promises.readFile(
      path.resolve('src/routes/encuestasRevisionRouter.ts'),
      'utf8',
    );

    expect(routerSource).toContain("'/:id/audios/:audioId'");
    expect(routerSource).toContain('sendPrivateFile');
    // Las dos (GET y HEAD) van con el rol delante; no hay una tercera sin él.
    expect(
      routerSource.match(/\/:id\/audios\/:audioId', requireRole\(\[Roles\.REVISOR_QA\]\)/g),
    ).toHaveLength(2);
  });
});

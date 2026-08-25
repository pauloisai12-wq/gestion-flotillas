// La subida de audios vista como la ve el teléfono: POST
// /api/v1/encuestas/:idLocal/audios de punta a punta, con el router real, el
// multer real, el servicio real, un Prisma con memoria y el errorHandler real.
// Lo que se fija aquí es el CONTRATO, que es lo que decide si la app borra el
// segmento de su cola local o lo reenvía para siempre:
//
//   201/200 {"audio_id":"…"} · 404 {"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}
//   422 validación e integridad (NUNCA 400) · 413 archivo enorme · 405 GET.
//
// El disco es REAL (un mkdtemp): la dedupe física y "no hay 2xx sin archivo
// persistido" solo se pueden comprobar mirando el directorio. `vi.hoisted` fija
// ENCUESTAS_AUDIO_DIR y el tope de 1 MB ANTES de que se importe env.ts, que lee
// process.env una sola vez al cargarse.
//
// El guard de dispositivo se prueba aparte (encuestas-device-auth.test.ts); aquí
// se inyecta un req.encuestaDevice ya autenticado, igual que hace el montaje.
// El rate-limit se sustituye por un passthrough: el real habla con Redis.

import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = await vi.hoisted(async () => {
  const fsm = await import('node:fs');
  const osm = await import('node:os');
  const pathm = await import('node:path');
  const d = fsm.mkdtempSync(pathm.join(osm.tmpdir(), 'enc-audio-http-'));
  process.env.ENCUESTAS_AUDIO_DIR = d;
  // 1 MB en vez de los 50 por defecto: así el caso del 413 no necesita mover
  // 50 MB por el socket en cada corrida del CI.
  process.env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB = '1';
  return d;
});

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
 * Prisma con memoria detrás del módulo real, para que el flujo router →
 * servicio → prisma corra entero. El Map replica el UNIQUE (encuesta, segmento)
 * y el P2002 que dispara el reintento del servicio; las encuestas son una lista
 * fija con dos dueños distintos, que es lo que permite probar que la encuesta de
 * otro dispositivo es indistinguible de una inexistente.
 */
const almacen = vi.hoisted(() => {
  const ENCUESTAS = [
    { id: 10, idLocal: 'e1-uuid', dispositivoId: 1 },
    { id: 20, idLocal: 'ajena-uuid', dispositivoId: 2 },
  ];
  type FilaAudio = { id: number; encuestaId: number; segmento: string; sha256: string } & Record<
    string,
    unknown
  >;
  const audios = new Map<string, FilaAudio>();
  let ultimoId = 0;
  const clave = (encuestaId: number, segmento: string) => `${encuestaId}|${segmento}`;
  return {
    audios,
    limpiar() {
      audios.clear();
      ultimoId = 0;
    },
    async encuestaFindFirst(args: { where: { idLocal: string; dispositivoId: number } }) {
      const e = ENCUESTAS.find(
        (x) => x.idLocal === args.where.idLocal && x.dispositivoId === args.where.dispositivoId,
      );
      return e ?? null;
    },
    async audioFindUnique(args: {
      where: { encuestaId_segmento: { encuestaId: number; segmento: string } };
    }) {
      const { encuestaId, segmento } = args.where.encuestaId_segmento;
      return audios.get(clave(encuestaId, segmento)) ?? null;
    },
    async audioCreate(args: {
      data: { encuestaId: number; segmento: string; sha256: string } & Record<string, unknown>;
    }) {
      const k = clave(args.data.encuestaId, args.data.segmento);
      if (audios.has(k)) {
        // Import diferido: el factory de vi.hoisted corre ANTES de los imports
        // del archivo, así que Prisma solo puede tocarse al invocar el método.
        const { Prisma } = await import('@prisma/client');
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const fila = { ...args.data, id: ++ultimoId, recibidoEn: new Date() } as FilaAudio;
      audios.set(k, fila);
      return fila;
    },
    async audioUpdate(args: { where: { id: number }; data: Record<string, unknown> }) {
      const entrada = [...audios.entries()].find(([, f]) => f.id === args.where.id);
      if (!entrada) throw new Error('fila de audio inexistente');
      const actualizada = { ...entrada[1], ...args.data } as FilaAudio;
      audios.set(entrada[0], actualizada);
      return actualizada;
    },
  };
});
vi.mock('../../src/lib/prisma', () => ({
  default: {
    encuesta: {
      findFirst: (args: Parameters<typeof almacen.encuestaFindFirst>[0]) =>
        almacen.encuestaFindFirst(args),
    },
    encuestaAudio: {
      findUnique: (args: Parameters<typeof almacen.audioFindUnique>[0]) =>
        almacen.audioFindUnique(args),
      create: (args: Parameters<typeof almacen.audioCreate>[0]) => almacen.audioCreate(args),
      update: (args: Parameters<typeof almacen.audioUpdate>[0]) => almacen.audioUpdate(args),
    },
  },
}));

import encuestasIngestRouter from '../../src/routes/encuestasIngestRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { sha256Of } from '../../src/lib/encuestasAudioStorage';
import { audioM4aMinimo } from './audioFixtures';

const RUTA = '/api/v1/encuestas';

function crearApp() {
  const app = express();
  // Mismo parser del montaje real; ante multipart no hace nada, pero se deja
  // para que el orden de middlewares sea el mismo que en index.ts.
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

type App = ReturnType<typeof crearApp>;

function subir(
  app: App,
  idLocal: string,
  buffer: Buffer,
  campos: Record<string, string | undefined>,
) {
  let r = request(app).post(`${RUTA}/${idLocal}/audios`);
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) r = r.field(k, v);
  return r.attach('audio', buffer, { filename: 'seg1.m4a', contentType: 'audio/mp4' });
}

const AUDIO = audioM4aMinimo({ duracionMs: 12_345 });
const camposDe = (buf: Buffer, segmento = 'seg1.m4a') => ({
  segmento,
  sha256: sha256Of(buf),
  tamano_bytes: String(buf.length),
});

/** Nombres de blob en el directorio (los .tmp se ignoran: son transitorios). */
function blobsEnDisco(): string[] {
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
}

beforeEach(() => {
  almacen.limpiar();
  // Directorio virgen en cada caso: así "un solo archivo en disco" es una
  // afirmación sobre ESTE test y no sobre lo que dejaron los anteriores.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /:idLocal/audios — encuesta no resoluble', () => {
  it('un idLocal desconocido responde 404 con la envolvente anidada EXACTA', async () => {
    const response = await subir(crearApp(), 'no-existe-uuid', AUDIO, camposDe(AUDIO));

    expect(response.status).toBe(404);
    // toEqual, no toMatchObject: el cliente compara la forma completa; un
    // requestId o un message de más rompería su parseo.
    expect(response.body).toEqual({ error: { code: 'ENCUESTA_NO_ENCONTRADA' } });
    expect(almacen.audios.size).toBe(0);
    expect(blobsEnDisco()).toEqual([]);
  });

  it('la encuesta de OTRO dispositivo es indistinguible de una inexistente', async () => {
    const response = await subir(crearApp(), 'ajena-uuid', AUDIO, camposDe(AUDIO));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'ENCUESTA_NO_ENCONTRADA' } });
    expect(almacen.audios.size).toBe(0);
  });
});

describe('POST /:idLocal/audios — alta y dedupe', () => {
  it('una subida válida responde 201 y deja fila y archivo persistidos', async () => {
    const response = await subir(crearApp(), 'e1-uuid', AUDIO, camposDe(AUDIO));

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ audio_id: '1' }); // string, nunca número
    const sha = sha256Of(AUDIO);
    const fila = [...almacen.audios.values()][0];
    expect(fila).toMatchObject({
      encuestaId: 10,
      segmento: 'seg1.m4a',
      sha256: sha,
      tamanoBytes: AUDIO.length,
      mimeDeclarado: 'audio/mp4',
      duracionMs: 12_345,
      ruta: `encuestas-audio/${sha}.m4a`,
    });
    expect(fs.readFileSync(path.join(dir, `${sha}.m4a`)).equals(AUDIO)).toBe(true);
  });

  it('el reenvío idéntico responde 200 con el MISMO audio_id y no reescribe el blob', async () => {
    const app = crearApp();
    const sha = sha256Of(AUDIO);

    const primera = await subir(app, 'e1-uuid', AUDIO, camposDe(AUDIO));
    // Marca de tiempo conocida en el pasado: si la segunda subida reescribiera
    // el blob, la mtime saltaría a "ahora". Comparar mtimes consecutivas no
    // serviría (dos escrituras seguidas pueden compartir marca de milisegundo).
    const archivo = path.join(dir, `${sha}.m4a`);
    const enElPasado = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(archivo, enElPasado, enElPasado);

    const reenvio = await subir(app, 'e1-uuid', AUDIO, camposDe(AUDIO));

    expect(primera.status).toBe(201);
    expect(reenvio.status).toBe(200); // nunca 204: la app necesita el audio_id
    expect(reenvio.body).toEqual({ audio_id: primera.body.audio_id });
    expect(almacen.audios.size).toBe(1);
    expect(fs.statSync(archivo).mtimeMs).toBe(enElPasado.getTime());
  });

  it('el mismo segmento con otro contenido responde 200, mismo audio_id y fila actualizada', async () => {
    const app = crearApp();
    const otro = audioM4aMinimo({ duracionMs: 3_000, relleno: 200 });

    const primera = await subir(app, 'e1-uuid', AUDIO, camposDe(AUDIO));
    const reemplazo = await subir(app, 'e1-uuid', otro, camposDe(otro));

    expect(reemplazo.status).toBe(200);
    expect(reemplazo.body.audio_id).toBe(primera.body.audio_id);
    expect(almacen.audios.size).toBe(1);
    const fila = [...almacen.audios.values()][0];
    expect(fila).toMatchObject({
      sha256: sha256Of(otro),
      tamanoBytes: otro.length,
      duracionMs: 3_000,
      ruta: `encuestas-audio/${sha256Of(otro)}.m4a`,
    });
  });

  it('dos segmentos con los MISMOS bytes son dos filas que comparten un solo blob', async () => {
    const app = crearApp();

    const seg1 = await subir(app, 'e1-uuid', AUDIO, camposDe(AUDIO));
    const seg2 = await subir(app, 'e1-uuid', AUDIO, camposDe(AUDIO, 'seg2.m4a'));

    expect(seg1.status).toBe(201);
    expect(seg2.status).toBe(201);
    expect(seg2.body.audio_id).not.toBe(seg1.body.audio_id);
    expect(almacen.audios.size).toBe(2);
    expect(blobsEnDisco()).toEqual([`${sha256Of(AUDIO)}.m4a`]);
  });
});

describe('POST /:idLocal/audios — rechazos (422, nunca 400)', () => {
  it('un sha256 declarado que no coincide responde 422 sin escribir la fila', async () => {
    const response = await subir(crearApp(), 'e1-uuid', AUDIO, {
      ...camposDe(AUDIO),
      sha256: 'a'.repeat(64),
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.issues[0].field).toBe('sha256');
    expect(almacen.audios.size).toBe(0);
    expect(blobsEnDisco()).toEqual([]);
  });

  it('un tamano_bytes que no coincide responde 422', async () => {
    const response = await subir(crearApp(), 'e1-uuid', AUDIO, {
      ...camposDe(AUDIO),
      tamano_bytes: String(AUDIO.length + 1),
    });

    expect(response.status).toBe(422);
    expect(response.body.issues[0].field).toBe('tamano_bytes');
    expect(almacen.audios.size).toBe(0);
    expect(blobsEnDisco()).toEqual([]);
  });

  it('sin la parte "audio" responde 422 señalando el campo audio', async () => {
    const campos = camposDe(AUDIO);
    let r = request(crearApp()).post(`${RUTA}/e1-uuid/audios`);
    for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
    const response = await r;

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.issues).toEqual([{ field: 'audio', message: expect.any(String) }]);
    expect(almacen.audios.size).toBe(0);
  });

  it('un segmento con separadores de ruta responde 422', async () => {
    const response = await subir(crearApp(), 'e1-uuid', AUDIO, {
      ...camposDe(AUDIO),
      segmento: '../x',
    });

    expect(response.status).toBe(422);
    expect(response.body.issues[0].field).toBe('segmento');
    expect(almacen.audios.size).toBe(0);
  });

  it('un sha256 en MAYÚSCULAS responde 422: el hex del contrato es minúsculas', async () => {
    const response = await subir(crearApp(), 'e1-uuid', AUDIO, {
      ...camposDe(AUDIO),
      sha256: sha256Of(AUDIO).toUpperCase(),
    });

    expect(response.status).toBe(422);
    expect(response.body.issues[0].field).toBe('sha256');
  });

  it('tamano_bytes = 0 responde 422: un segmento vacío no es un segmento', async () => {
    const response = await subir(crearApp(), 'e1-uuid', AUDIO, {
      ...camposDe(AUDIO),
      tamano_bytes: '0',
    });

    expect(response.status).toBe(422);
    expect(response.body.issues[0].field).toBe('tamano_bytes');
  });

  it('una parte de archivo con otro nombre responde 422, no 400', async () => {
    // multer levanta LIMIT_UNEXPECTED_FILE; el errorHandler global lo mapearía a
    // 400, que el cliente leería como transitorio y reintentaría para siempre.
    const campos = camposDe(AUDIO);
    let r = request(crearApp()).post(`${RUTA}/e1-uuid/audios`);
    for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
    const response = await r.attach('foto', AUDIO, {
      filename: 'seg1.m4a',
      contentType: 'audio/mp4',
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(almacen.audios.size).toBe(0);
  });
});

describe('POST /:idLocal/audios — límite de tamaño', () => {
  it('un archivo por encima del tope responde 413, no 400', async () => {
    const enorme = Buffer.alloc(1024 * 1024 + 1, 0xab);

    const response = await subir(crearApp(), 'e1-uuid', enorme, camposDe(enorme));

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(almacen.audios.size).toBe(0);
    expect(blobsEnDisco()).toEqual([]);
  });
});

describe('GET /:idLocal/audios', () => {
  it('responde 405, no 401: la key sirve, el método no', async () => {
    const response = await request(crearApp()).get(`${RUTA}/e1-uuid/audios`);

    expect(response.status).toBe(405);
    expect(response.body.code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('POST /:idLocal/audios — silencio en el log', () => {
  it('no filtra ni el sha256 ni los bytes del audio al log', async () => {
    const app = crearApp();
    await subir(app, 'e1-uuid', AUDIO, camposDe(AUDIO));
    await subir(app, 'no-existe-uuid', AUDIO, camposDe(AUDIO));

    const log = JSON.stringify(
      [registrado.error, registrado.warn, registrado.info, registrado.debug].map(
        (fn) => fn.mock.calls,
      ),
    );
    expect(log).not.toContain(sha256Of(AUDIO));
    expect(log).not.toContain('e1-uuid');
    expect(registrado.error).not.toHaveBeenCalled();
  });
});

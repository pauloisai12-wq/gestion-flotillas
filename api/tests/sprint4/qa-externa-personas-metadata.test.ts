// Tope de `metadata` en POST /api/qa-externa/personas: la vía JSON tiene que
// cortar en el MISMO número que el `fieldSize` de multer corta la vía multipart.
// Antes no lo hacía: el único límite por JSON era el `express.json({limit:'2mb'})`
// global, el objeto se re-serializaba entero a la columna TEXT `metadata_raw` y un
// dispositivo con key válida persistía ~1.9 MB por fila — mientras que el MISMO
// payload por multipart ya devolvía 400.
//
// Se monta el router real con supertest. El guard de dispositivo y el rate-limit
// por IP viven en el MONTAJE (index.ts), no en el router, así que aquí se inyecta
// `req.device` a mano igual que haría deviceAuthMiddleware.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// El router arrastra prisma, la cola BullMQ y el cliente Redis por sus imports;
// ninguno debe abrir conexiones reales en un test unitario.
vi.mock('../../src/lib/prisma', () => ({ default: {} }));
vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/lib/redis', () => ({
  getRedis: () => ({ eval: async () => 1, ttl: async () => 60 }),
}));
vi.mock('../../src/services/mediaThumbnailService', () => ({
  enqueueQaThumbnail: vi.fn(),
}));
vi.mock('../../src/services/qaExternaService', () => ({ ingest: vi.fn() }));

const ingestPersona = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/qaExternaPersonaService', () => ({ ingestPersona }));

import qaExternaRouter, {
  QA_PERSONAS_MAX_CAMPO_BYTES,
} from '../../src/routes/qaExternaRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';

function crearApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.device = { id: 3, identificador: 'BUF-01', programa: 'LX' };
    next();
  });
  app.use('/api/qa-externa', qaExternaRouter);
  app.use(errorHandler);
  return app;
}

const RUTA = '/api/qa-externa/personas';

const BASE = {
  cliente_registro_id: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  identificador_app: 'geocampo-tablet-07',
  nombre: 'María Pérez',
  telefono: '+52 55 1234 5678',
  lat: 19.432608,
  lng: -99.133209,
  capturado_at: '2026-07-20T15:30:00.000Z',
};

/** `metadata` cuyo JSON serializado pesa `bytes` aproximados. */
function metadataDe(bytes: number) {
  return { notas: 'x'.repeat(bytes) };
}

describe('POST /personas — tope de metadata simétrico entre JSON y multipart', () => {
  it('rechaza con 400 un metadata que excede el tope por la vía JSON', async () => {
    ingestPersona.mockResolvedValue({ registroId: 42 });

    const response = await request(crearApp())
      .post(RUTA)
      .send({ ...BASE, metadata: metadataDe(QA_PERSONAS_MAX_CAMPO_BYTES + 5_000) });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body.error).toBe('metadata excede el tamaño máximo de 64 KB');
    // Lo que importa: la fila gigante NUNCA llega al upsert.
    expect(ingestPersona).not.toHaveBeenCalled();
  });

  it('acepta un metadata por debajo del tope y lo persiste re-serializado', async () => {
    ingestPersona.mockResolvedValue({ registroId: 42 });
    const metadata = metadataDe(QA_PERSONAS_MAX_CAMPO_BYTES - 5_000);

    const response = await request(crearApp())
      .post(RUTA)
      .send({ ...BASE, metadata });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ registro_id: 42 });
    expect(ingestPersona).toHaveBeenCalledTimes(1);
    expect(ingestPersona.mock.calls[0][0].metadataRaw).toBe(JSON.stringify(metadata));
  });

  it('el MISMO payload por multipart también da 400 (mismo tope, otra vía)', async () => {
    ingestPersona.mockResolvedValue({ registroId: 42 });
    const grande = JSON.stringify(metadataDe(QA_PERSONAS_MAX_CAMPO_BYTES + 5_000));

    const response = await request(crearApp())
      .post(RUTA)
      .field('cliente_registro_id', BASE.cliente_registro_id)
      .field('identificador_app', BASE.identificador_app)
      .field('nombre', BASE.nombre)
      .field('telefono', BASE.telefono)
      .field('lat', String(BASE.lat))
      .field('lng', String(BASE.lng))
      .field('capturado_at', BASE.capturado_at)
      .field('metadata', grande);

    // Aquí corta multer (`limits.fieldSize`), no el handler: el código difiere,
    // pero el veredicto y el número son los mismos.
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('LIMIT_FIELD_VALUE');
    expect(ingestPersona).not.toHaveBeenCalled();
  });

  it('el tope de multer y el del handler salen de la MISMA constante', () => {
    expect(QA_PERSONAS_MAX_CAMPO_BYTES).toBe(64 * 1024);
  });
});

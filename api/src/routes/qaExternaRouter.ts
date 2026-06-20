// Rutas qa_externa. El guard de dispositivo (deviceAuthMiddleware) y el
// rate-limit por IP se aplican en el MONTAJE (index.ts), de modo que el auth
// precede a TODA ruta/método aquí — incluido el 405 de GET /ingest (red de
// seguridad B para la app actual, que aún hace GET sobre /ingest).

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { rateLimit } from '../middlewares/rateLimit';
import { ah } from '../lib/asyncHandler';
import { BadRequest } from '../middlewares/errorHandler';
import { qaExternaIngestSchema } from '../validators/qaExternaValidator';
import * as qaExternaService from '../services/qaExternaService';
import { env } from '../config/env';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.QA_EXTERNA_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: env.QA_EXTERNA_MAX_FILES,
  },
  // Descarta archivos que no sean JPEG por extensión/mime (cb(null,false), sin
  // error → si no queda ninguno, el handler responde 400). El JPEG REAL se
  // valida por magic bytes en processImage.
  fileFilter: (_req, file, cb) => {
    const okExt = /\.jpe?g$/i.test(file.originalname);
    const okMime = file.mimetype === 'image/jpeg';
    cb(null, okExt && okMime);
  },
});

// Rate-limit por dispositivo (ya autenticado por el guard del montaje).
const perDeviceLimit = rateLimit({
  max: env.QA_EXTERNA_RATE_MAX,
  windowSec: env.QA_EXTERNA_RATE_WINDOW_SEC,
  keyBuilder: (req) => `qae:dev:${req.device?.id ?? 'unknown'}`,
  message: 'Demasiadas subidas desde este dispositivo. Intenta más tarde.',
});

const router = Router();

// Opción A: probar conexión limpio.
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Red de seguridad B: la app actual hace GET sobre /ingest. Tras el auth, un 405
// (no-5xx, ≠401/403) es leído por la app como "Conexión OK".
router.get('/ingest', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
});

router.post(
  '/ingest',
  perDeviceLimit,
  upload.array('imagenes[]', env.QA_EXTERNA_MAX_FILES),
  ah(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      throw BadRequest('Se requiere al menos una imagen JPEG (campo imagenes[])');
    }

    // metadata es un string JSON: {"tipo":"...","notas":<string|null>}
    let metadata: { tipo?: unknown; notas?: unknown };
    try {
      metadata = JSON.parse(req.body.metadata ?? '') as { tipo?: unknown; notas?: unknown };
    } catch {
      throw BadRequest('metadata no es un JSON válido');
    }

    // Multipart entrega strings: armado manual del body antes de validar.
    const body = {
      clienteRegistroId: req.body.cliente_registro_id,
      identificadorApp: req.body.identificador_app,
      lat: req.body.lat,
      lng: req.body.lng,
      ...(req.body.accuracy !== undefined && req.body.accuracy !== ''
        ? { accuracy: req.body.accuracy }
        : {}),
      capturadoAt: req.body.capturado_at,
      tipo: metadata.tipo,
      notas: metadata.notas ?? null,
    };

    const parsed = qaExternaIngestSchema.safeParse(body);
    if (!parsed.success) {
      // Mismo formato que el errorHandler global (VALIDATION_ERROR), inline para
      // no depender de instanceof entre subpaths de zod.
      res.status(400).json({
        error: 'Datos inválidos',
        code: 'VALIDATION_ERROR',
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const result = await qaExternaService.ingest({
      clienteRegistroId: parsed.data.clienteRegistroId,
      dispositivoId: req.device!.id,
      identificadorApp: parsed.data.identificadorApp,
      tipo: parsed.data.tipo,
      // Estampado server-side desde el dispositivo autenticado; el cliente
      // nunca lo envía (ni en body ni en metadata).
      programa: req.device!.programa,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      accuracy: parsed.data.accuracy,
      capturadoAt: parsed.data.capturadoAt,
      notas: parsed.data.notas ?? null,
      metadataRaw: req.body.metadata,
      buffers: files.map((f) => f.buffer),
    });

    res.status(200).json({ registro_id: result.registroId, imagenes: result.imagenes });
  }),
);

export default router;

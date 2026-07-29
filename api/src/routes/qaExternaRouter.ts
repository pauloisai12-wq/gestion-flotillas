// Rutas qa_externa. El guard de dispositivo (deviceAuthMiddleware) y el
// rate-limit por IP se aplican en el MONTAJE (index.ts), de modo que el auth
// precede a TODA ruta/método aquí — incluido el 405 de GET /ingest (red de
// seguridad B para la app actual, que aún hace GET sobre /ingest).
//
// GeoCampo manda hoy DOS capturas por este router: la evidencia con fotos
// (POST /ingest, multipart obligatorio) y el registro de personas sin foto
// (POST /personas, JSON o multipart). Ambas comparten API key, rate-limit por
// dispositivo e idempotencia por cliente_registro_id.

import { Router, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { rateLimit } from '../middlewares/rateLimit';
import { ah } from '../lib/asyncHandler';
import { BadRequest } from '../middlewares/errorHandler';
import { qaExternaIngestSchema } from '../validators/qaExternaValidator';
import { qaExternaPersonaIngestSchema } from '../validators/qaExternaPersonaValidator';
import * as qaExternaService from '../services/qaExternaService';
import * as qaExternaPersonaService from '../services/qaExternaPersonaService';
import { env } from '../config/env';
import { enqueueQaThumbnail } from '../services/mediaThumbnailService';

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
//
// Existen TRES cubos, ninguno de los cuales comparte contador con otro:
//
//   1. `rl:qae:dev:<dispositivo_id>` — QA_EXTERNA_RATE_MAX (60) por ventana.
//      Solo POST /ingest. Protege la cuota de subida de EVIDENCIA.
//   2. `rl:qae:per:<dispositivo_id>` — QA_EXTERNA_RATE_MAX (60) por ventana.
//      Solo POST /personas. Protege la cuota del REGISTRO DE PERSONAS.
//   3. `rl:qae:ip:<ip>` — QA_EXTERNA_IP_RATE_MAX (120 = 2 × 60), en el montaje
//      (index.ts). Común a todo /api/qa-externa/*, porque corre ANTES del auth y
//      no puede saber qué captura es. Protege contra el SONDEO de API keys.
//
// Los dos primeros van separados para que un teléfono que estuvo sin señal y
// vacía las dos colas al recuperarla (p. ej. 50 personas + 20 evidencias en el
// mismo minuto contra un tope de 60) no vea morir con 429 las últimas subidas de
// EVIDENCIA, que son las caras: van con fotos. El tercero lleva el DOBLE de
// cuota por el mismo motivo: con el mismo número que los otros dos, ese teléfono
// gastaría 70 de 60 en el cubo por IP y el 429 volvería por la puerta de atrás.
const perDeviceLimit = rateLimit({
  max: env.QA_EXTERNA_RATE_MAX,
  windowSec: env.QA_EXTERNA_RATE_WINDOW_SEC,
  keyBuilder: (req) => `qae:dev:${req.device?.id ?? 'unknown'}`,
  message: 'Demasiadas subidas desde este dispositivo. Intenta más tarde.',
});

const perPersonaLimit = rateLimit({
  max: env.QA_EXTERNA_RATE_MAX,
  windowSec: env.QA_EXTERNA_RATE_WINDOW_SEC,
  keyBuilder: (req) => `qae:per:${req.device?.id ?? 'unknown'}`,
  message: 'Demasiados registros de personas desde este dispositivo. Intenta más tarde.',
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

    await Promise.all(
      result.imagenes.map((image) =>
        enqueueQaThumbnail(req.device!.programa, image.sha256),
      ),
    );

    res.status(200).json({ registro_id: result.registroId, imagenes: result.imagenes });
  }),
);

// El registro de personas no lleva archivos, pero el equipo móvil reutiliza su
// uploader multipart (el mismo que usa para /ingest) y otros clientes mandan
// JSON plano: se aceptan las dos formas. multer().none() solo puebla req.body
// con los campos de texto de un multipart; para JSON el express.json global
// (index.ts:149, límite 2mb) ya lo parseó y aquí basta con seguir.
//
// Los `limits` NO son decorativos: por defecto busboy trae `fields: Infinity` y
// `parts: Infinity`, así que UN solo POST multipart con decenas de miles de
// campos de texto se acumula entero en req.body antes de que el handler exista,
// y el rate-limit no defiende de eso (basta una petición). En un contenedor que
// comparte hardware con el SAS, ese pico de RSS es el problema. `files: 0`
// duplica a propósito lo que ya hace .none(): aquí NUNCA se aceptan archivos.
/**
 * Tope de un campo de texto del formulario, en bytes. Se usa en DOS sitios que
 * deben decir lo mismo: el `limits.fieldSize` de multer (vía multipart) y la
 * comprobación de `metadata` del handler (vía JSON). Si se desincronizan reaparece
 * la asimetría que motivó la constante: el mismo payload daba 400 por multipart y
 * 200 por JSON, y en la vía JSON el objeto se re-serializa entero a la columna
 * TEXT `metadata_raw` — con la cuota por dispositivo, ~114 MB/min de escritura en
 * un Postgres que comparte hardware con el SAS.
 */
export const QA_PERSONAS_MAX_CAMPO_BYTES = 64 * 1024;

const noFiles = multer({
  limits: { files: 0, fields: 20, fieldSize: QA_PERSONAS_MAX_CAMPO_BYTES, parts: 25 },
}).none();

const parseFlexibleBody: RequestHandler = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    noFiles(req, res, next);
    return;
  }
  next();
};

// Misma red de seguridad que en /ingest: si la app equivoca el método, el 401
// que devolverían los comodines `app.use('/api', authMiddleware, …)`
// (index.ts:269,274) al no encontrar aquí un GET /personas se lee en el móvil como
// "API key inválida" y dispara una reconfiguración innecesaria. Un 405 dice lo
// que realmente pasa: la key sirve, el método no.
router.get('/personas', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
});

router.post(
  '/personas',
  perPersonaLimit,
  parseFlexibleBody,
  ah(async (req: Request, res: Response) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;

    // metadata es OPCIONAL aquí (a diferencia de /ingest, donde transporta
    // tipo/notas): se guarda crudo tal como llegó, y si no viene la columna
    // queda en NULL. Igual que en /ingest, un JSON roto es error del cliente.
    let metadataRaw: string | null = null;
    if (typeof raw.metadata === 'string' && raw.metadata !== '') {
      try {
        JSON.parse(raw.metadata);
      } catch {
        throw BadRequest('metadata no es un JSON válido');
      }
      metadataRaw = raw.metadata;
    } else if (raw.metadata !== undefined && raw.metadata !== null && raw.metadata !== '') {
      // Cliente JSON: express.json ya lo convirtió en objeto; se re-serializa
      // para persistirlo en la misma columna de texto.
      metadataRaw = JSON.stringify(raw.metadata);
    }

    // Mismo tope que el `fieldSize` de multer, aplicado también a la vía JSON.
    // Sin esto, el único límite por JSON era el `express.json({ limit: '2mb' })`
    // global (index.ts) y un cliente con key válida —o una app con un bug de
    // acumulación de logs— persistía ~1.9 MB por fila; el MISMO payload por
    // multipart ya devolvía 400.
    if (
      metadataRaw !== null &&
      Buffer.byteLength(metadataRaw, 'utf8') > QA_PERSONAS_MAX_CAMPO_BYTES
    ) {
      throw BadRequest(
        `metadata excede el tamaño máximo de ${QA_PERSONAS_MAX_CAMPO_BYTES / 1024} KB`,
      );
    }

    // Multipart entrega strings: armado manual del body antes de validar.
    const body = {
      clienteRegistroId: raw.cliente_registro_id,
      identificadorApp: raw.identificador_app,
      nombre: raw.nombre,
      telefono: raw.telefono,
      lat: raw.lat,
      lng: raw.lng,
      // `null` cuenta como ausente SOLO aquí: multipart nunca lo produce (un
      // campo vacío llega como '' y uno ausente como undefined), pero el cliente
      // JSON sí manda accuracy:null cuando el GPS no reportó precisión. lat/lng
      // no reciben este trato: son obligatorias y un null debe caer en el 400,
      // nunca convertirse en la coordenada 0,0.
      ...(raw.accuracy == null || raw.accuracy === '' ? {} : { accuracy: raw.accuracy }),
      capturadoAt: raw.capturado_at,
    };

    const parsed = qaExternaPersonaIngestSchema.safeParse(body);
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

    const result = await qaExternaPersonaService.ingestPersona({
      clienteRegistroId: parsed.data.clienteRegistroId,
      dispositivoId: req.device!.id,
      identificadorApp: parsed.data.identificadorApp,
      // Estampado server-side desde el dispositivo autenticado; el cliente
      // nunca lo envía (ni en body ni en metadata).
      programa: req.device!.programa,
      nombre: parsed.data.nombre,
      telefono: parsed.data.telefono,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      accuracy: parsed.data.accuracy,
      capturadoAt: parsed.data.capturadoAt,
      metadataRaw,
    });

    res.status(200).json({ registro_id: result.registroId });
  }),
);

export default router;

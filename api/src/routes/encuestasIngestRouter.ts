// Ingesta de la app "Encuestas Okrean" (v1, v3 y v4) y de los AUDIOS de cada
// encuesta. El guard de dispositivo (encuestasDeviceAuthMiddleware), el cubo de
// rate-limit por IP y el express.json de 256 KB se aplican en el MONTAJE
// (index.ts), de modo que el auth precede a TODA ruta/método de aquí — incluido
// el 405 de GET /.
//
// Contrato con el teléfono, en tres reglas que no se negocian:
//   · la respuesta SIEMPRE es {"idRemoto":"..."} con 201 (alta) o 200 (reenvío
//     del mismo contenido). NUNCA 204: sin cuerpo, la app no puede cerrar el
//     registro en su cola local y lo reenviaría para siempre;
//   · un payload que no valida es 422, no 400 (el 400 queda para el JSON
//     malformado y el body que no es un objeto);
//   · NO se loguea nada del contenido: ni body, ni respuestas políticas, ni
//     coordenadas, ni la API key. Solo el requestId que estampa pino-http.
//
// La subida de audios (POST /:idLocal/audios) añade una cuarta regla propia: el
// 404 con envolvente ANIDADA. Ver el bloque de audios más abajo.

import { Router, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import type { ZodType } from 'zod';
import { rateLimit } from '../middlewares/rateLimit';
import { ah } from '../lib/asyncHandler';
import prisma from '../lib/prisma';
import { BadRequest } from '../middlewares/errorHandler';
import { sha256Of } from '../lib/encuestasAudioStorage';
import { audioCamposSchema } from '../validators/encuestasAudioValidator';
import { guardarAudioEncuesta } from '../services/encuestasAudioService';
import {
  encuestaV1Schema,
  encuestaV3Schema,
  encuestaV4Schema,
  type EncuestaV1,
  type EncuestaV3,
  type EncuestaV4,
} from '../validators/encuestasIngestValidator';
import { hashEncuestaV1, hashEncuestaV3, hashEncuestaV4 } from '../lib/encuestasCanonical';
import { ingestEncuesta } from '../services/encuestasIngestService';
import { env } from '../config/env';

/** Lo que deja el paso "validar + hashear" de una versión, ya sin zod a la vista. */
type ResultadoVersion =
  | { ok: true; parsed: EncuestaV1 | EncuestaV3 | EncuestaV4; payloadHash: string }
  | { ok: false; issues: { path: PropertyKey[]; message: string }[] };

/**
 * Empareja el schema de una versión con SU canónico en un solo paso. El
 * genérico ata ambos: el hash recibe exactamente lo que produce el schema, así
 * que una pareja cruzada (validar con v3 y hashear con v1) no compila.
 */
function validadorDe<T extends EncuestaV1 | EncuestaV3 | EncuestaV4>(
  schema: ZodType<T>,
  hash: (d: T) => string,
): (body: unknown) => ResultadoVersion {
  return (body) => {
    const p = schema.safeParse(body);
    return p.success
      ? { ok: true, parsed: p.data, payloadHash: hash(p.data) }
      : { ok: false, issues: p.error.issues };
  };
}

/**
 * ÚNICA fuente de verdad de las versiones soportadas: el gate se deriva de las
 * llaves de esta tabla, no de una lista aparte. Sin este acoplamiento, declarar
 * una v5 soportada sin darle schema/canónico propios la haría pasar el gate y
 * persistirse en silencio con el canónico de otra versión; aquí una versión sin
 * entrada cae siempre en UNSUPPORTED_VERSION.
 */
const POR_VERSION: Partial<Record<number, (body: unknown) => ResultadoVersion>> = {
  1: validadorDe(encuestaV1Schema, hashEncuestaV1),
  3: validadorDe(encuestaV3Schema, hashEncuestaV3),
  4: validadorDe(encuestaV4Schema, hashEncuestaV4),
};

// Cuota de captura POR DISPOSITIVO (cubo `rl:enc:dev:<id>`), separada del cubo
// por IP del montaje (`rl:enc:ip:<ip>`, pre-auth y anti-sondeo de keys). Cubos
// distintos porque miden cosas distintas: aquí ya sabemos QUÉ teléfono envía.
const perDeviceLimit = rateLimit({
  max: env.ENCUESTAS_RATE_MAX,
  windowSec: env.ENCUESTAS_RATE_WINDOW_SEC,
  keyBuilder: (req) => `enc:dev:${req.encuestaDevice?.id ?? 'unknown'}`,
  message: 'Demasiados envíos desde este dispositivo. Intenta más tarde.',
});

const router = Router();

/** requestId que estampa pino-http; mismo campo que devuelve el errorHandler. */
function requestIdDe(res: Response): string | undefined {
  return res.getHeader('x-request-id') as string | undefined;
}

// Prueba de conexión de la app (tras el auth: un 200 aquí confirma que la key
// sirve).
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Misma red de seguridad que en qa_externa: si la app equivoca el método, el
// 401 que devolverían los comodines `app.use('/api', authMiddleware, …)`
// (index.ts) al no encontrar aquí un GET se lee en el móvil como "API key
// inválida" y dispara una reconfiguración innecesaria. Un 405 dice lo que
// realmente pasa: la key sirve, el método no.
router.get('/', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
});

router.post(
  '/',
  perDeviceLimit,
  ah(async (req: Request, res: Response) => {
    // express.json deja `{}` cuando no hay cuerpo o el Content-Type no es JSON,
    // y acepta arrays como raíz. Ninguna de esas formas es una encuesta: se
    // cortan antes del dispatch de versión para no responder un 422 que hablaría
    // de campos inexistentes.
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw BadRequest('Se esperaba un objeto JSON (Content-Type: application/json)');
    }

    // Dispatch de versión ANTES del schema: cada schema conoce SOLO su propio
    // cuestionario y del resto únicamente sabe rechazar; un cuestionario de otra
    // versión (una v2 legítima de una app antigua) merece un código propio
    // (UNSUPPORTED_VERSION) para que la app distinga "tengo que actualizar el
    // servidor" de "este registro está mal y nunca subirá".
    const versionCuestionario = (body as Record<string, unknown>).versionCuestionario;
    if (
      typeof versionCuestionario !== 'number' ||
      !Number.isInteger(versionCuestionario) ||
      versionCuestionario < 1
    ) {
      res.status(422).json({
        error: 'Datos inválidos',
        code: 'VALIDATION_ERROR',
        issues: [
          {
            field: 'versionCuestionario',
            message: 'versionCuestionario debe ser un entero positivo',
          },
        ],
        requestId: requestIdDe(res),
      });
      return;
    }
    const validarVersion = POR_VERSION[versionCuestionario];
    if (!validarVersion) {
      res.status(422).json({
        error: 'Versión de cuestionario no soportada',
        code: 'UNSUPPORTED_VERSION',
        details: { versionCuestionario },
        requestId: requestIdDe(res),
      });
      return;
    }

    // Cada versión valida y hashea con su propio schema/canónico (la pareja que
    // fija POR_VERSION); el resto del flujo (idempotencia, respuesta) es común.
    // El hash sale de lo VALIDADO (ya sin los campos de la cola de envío del
    // teléfono); el crudo se guarda aparte, solo para auditoría.
    const resultado = validarVersion(body);

    if (!resultado.ok) {
      // Mismo formato que el errorHandler global (VALIDATION_ERROR), inline y
      // con status 422: relanzar el ZodError lo convertiría en 400, que aquí
      // significa otra cosa (JSON malformado / body no-objeto). Inline también
      // evita depender de `instanceof` entre subpaths de zod.
      res.status(422).json({
        error: 'Datos inválidos',
        code: 'VALIDATION_ERROR',
        issues: resultado.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
        requestId: requestIdDe(res),
      });
      return;
    }

    const payloadRaw = JSON.stringify(req.body);

    const { idRemoto, created } = await ingestEncuesta({
      parsed: resultado.parsed,
      // Estampado server-side desde la API key autenticada.
      dispositivoId: req.encuestaDevice!.id,
      payloadHash: resultado.payloadHash,
      payloadRaw,
    });

    res.status(created ? 201 : 200).json({ idRemoto });
  }),
);

// ─── Audios de la encuesta ───────────────────────────────────────────────────
//
// POST /:idLocal/audios (multipart). Cuatro reglas del contrato que difieren del
// resto del repo y NO se "arreglan":
//   1. Encuesta desconocida (o de otro dispositivo) → 404 con cuerpo EXACTO
//      {"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}. Es la única envolvente
//      anidada del API: el cliente distingue por ese código "encuesta
//      desconocida, reintentar luego" de "la ruta no existe, cortar la pasada".
//      Sin requestId ni message: el cliente no los espera.
//   2. Archivo demasiado grande → 413 (rechazo definitivo del segmento), aunque
//      el errorHandler global mapea multer a 400.
//   3. Toda validación → 422 con issues[]. NUNCA 400: el cliente lo trata como
//      transitorio y reencolaría el archivo para siempre.
//   4. Se resuelve la encuesta ANTES de parsear el multipart: un idLocal
//      desconocido no debe costar 50 MB de RAM. Node drena el cuerpo no leído al
//      responder (req._dump), así que el cliente recibe el 404 limpio.

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 10,
    fieldSize: 1024,
    parts: 12,
  },
}).single('audio');

const MULTER_ISSUES: Record<string, { field: string; message: string }> = {
  LIMIT_FILE_COUNT: { field: 'audio', message: 'Solo se admite un archivo por petición' },
  LIMIT_UNEXPECTED_FILE: { field: 'audio', message: 'La parte de archivo debe llamarse "audio"' },
  LIMIT_FIELD_COUNT: { field: 'segmento', message: 'Demasiados campos en el formulario' },
  LIMIT_FIELD_KEY: { field: 'segmento', message: 'Nombre de campo demasiado largo' },
  LIMIT_FIELD_VALUE: { field: 'segmento', message: 'Un campo del formulario excede el tamaño permitido' },
  LIMIT_PART_COUNT: { field: 'audio', message: 'Demasiadas partes en el formulario' },
};

function responder422(res: Response, issues: { field: string; message: string }[]): void {
  res.status(422).json({
    error: 'Datos inválidos',
    code: 'VALIDATION_ERROR',
    issues,
    requestId: requestIdDe(res),
  });
}

/** multer con los errores traducidos al contrato (413 tamaño, 422 el resto). */
const uploadAudioConContrato: RequestHandler = (req, res, next) => {
  uploadAudio(req, res, (err: unknown) => {
    if (!err) return next();
    const m = err as { name?: string; code?: string; field?: string };
    if (m.name !== 'MulterError') return next(err);
    if (m.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: `El audio supera el máximo de ${env.ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB} MB`,
        code: 'PAYLOAD_TOO_LARGE',
        requestId: requestIdDe(res),
      });
      return;
    }
    const conocido = MULTER_ISSUES[m.code ?? ''] ?? { field: 'audio', message: 'Formulario multipart inválido' };
    responder422(res, [{ field: m.field ?? conocido.field, message: conocido.message }]);
  });
};

/** Resuelve la encuesta por idLocal DENTRO del dispositivo autenticado; deja el id en res.locals. */
const resolverEncuestaDelDispositivo = ah(async (req: Request, res: Response, next) => {
  const encuesta = await prisma.encuesta.findFirst({
    where: { idLocal: req.params.idLocal, dispositivoId: req.encuestaDevice!.id },
    select: { id: true },
  });
  if (!encuesta) {
    res.status(404).json({ error: { code: 'ENCUESTA_NO_ENCONTRADA' } });
    return;
  }
  res.locals.encuestaId = encuesta.id;
  next();
});

// Misma red de seguridad que el 405 de GET /: si la app equivoca el método, un
// 401 del comodín de /api se leería en el móvil como "API key inválida".
router.get('/:idLocal/audios', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
});

router.post(
  '/:idLocal/audios',
  perDeviceLimit,
  resolverEncuestaDelDispositivo,
  uploadAudioConContrato,
  ah(async (req: Request, res: Response) => {
    const campos = audioCamposSchema.safeParse(req.body ?? {});
    const issues = campos.success
      ? []
      : campos.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    const archivo = req.file;
    if (!archivo) issues.push({ field: 'audio', message: 'Falta la parte "audio" con el archivo' });
    if (!campos.success || !archivo) {
      responder422(res, issues);
      return;
    }

    // Integridad de la subida: hash y tamaño declarados contra lo recibido. Un
    // fallo aquí es una subida truncada/corrupta; el cliente reencola y reintenta.
    const sha256 = sha256Of(archivo.buffer);
    const integridad: { field: string; message: string }[] = [];
    if (sha256 !== campos.data.sha256) {
      integridad.push({ field: 'sha256', message: 'El SHA-256 del contenido recibido no coincide con el declarado' });
    }
    if (archivo.buffer.length !== campos.data.tamano_bytes) {
      integridad.push({ field: 'tamano_bytes', message: `Se recibieron ${archivo.buffer.length} bytes y se declararon ${campos.data.tamano_bytes}` });
    }
    if (integridad.length) {
      responder422(res, integridad);
      return;
    }

    const { audioId, created } = await guardarAudioEncuesta({
      encuestaId: res.locals.encuestaId as number,
      segmento: campos.data.segmento,
      sha256,
      tamanoBytes: campos.data.tamano_bytes,
      mimeDeclarado: archivo.mimetype || null,
      buffer: archivo.buffer,
    });
    res.status(created ? 201 : 200).json({ audio_id: String(audioId) });
  }),
);

export default router;

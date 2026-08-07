// Ingesta de la app "Encuestas Okrean" (v1 y v3). El guard de dispositivo
// (encuestasDeviceAuthMiddleware), el cubo de rate-limit por IP y el
// express.json de 256 KB se aplican en el MONTAJE (index.ts), de modo que el
// auth precede a TODA ruta/método de aquí — incluido el 405 de GET /.
//
// Contrato con el teléfono, en tres reglas que no se negocian:
//   · la respuesta SIEMPRE es {"idRemoto":"..."} con 201 (alta) o 200 (reenvío
//     del mismo contenido). NUNCA 204: sin cuerpo, la app no puede cerrar el
//     registro en su cola local y lo reenviaría para siempre;
//   · un payload que no valida es 422, no 400 (el 400 queda para el JSON
//     malformado y el body que no es un objeto);
//   · NO se loguea nada del contenido: ni body, ni respuestas políticas, ni
//     coordenadas, ni la API key. Solo el requestId que estampa pino-http.

import { Router, Request, Response } from 'express';
import { rateLimit } from '../middlewares/rateLimit';
import { ah } from '../lib/asyncHandler';
import { BadRequest } from '../middlewares/errorHandler';
import {
  encuestaV1Schema,
  encuestaV3Schema,
} from '../validators/encuestasIngestValidator';
import { hashEncuestaV1, hashEncuestaV3 } from '../lib/encuestasCanonical';
import { ingestEncuesta } from '../services/encuestasIngestService';
import { env } from '../config/env';

/** Versiones de cuestionario que este servidor sabe persistir. */
const VERSIONES_SOPORTADAS = [1, 3] as const;

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
    if (!VERSIONES_SOPORTADAS.includes(versionCuestionario as 1 | 3)) {
      res.status(422).json({
        error: 'Versión de cuestionario no soportada',
        code: 'UNSUPPORTED_VERSION',
        details: { versionCuestionario },
        requestId: requestIdDe(res),
      });
      return;
    }

    // Cada versión valida y hashea con su propio schema/canónico; el resto del
    // flujo (idempotencia, respuesta) es común. El hash sale de lo VALIDADO (ya
    // sin los campos de la cola de envío del teléfono); el crudo se guarda
    // aparte, solo para auditoría.
    const resultado =
      versionCuestionario === 1
        ? (() => {
            const p = encuestaV1Schema.safeParse(body);
            return p.success
              ? { ok: true as const, parsed: p.data, payloadHash: hashEncuestaV1(p.data) }
              : { ok: false as const, issues: p.error.issues };
          })()
        : (() => {
            const p = encuestaV3Schema.safeParse(body);
            return p.success
              ? { ok: true as const, parsed: p.data, payloadHash: hashEncuestaV3(p.data) }
              : { ok: false as const, issues: p.error.issues };
          })();

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

export default router;

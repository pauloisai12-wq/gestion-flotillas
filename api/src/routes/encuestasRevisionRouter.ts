// Router de lectura de "Encuestas Okrean" (lado REVISOR_QA). Va montado en
// /api/encuestas con el authMiddleware (JWT) del montaje, y NO como subruta de
// /api/v1/encuestas/*, que pertenece al router de ingesta con guard por API key:
// mezclarlos dejaría el listado tras una autenticación de dispositivo, no de
// revisor. Aun así, cada ruta repite requireRole([REVISOR_QA]): el rol es la
// única barrera entre un usuario autenticado cualquiera y las respuestas
// políticas de la encuesta.
//
// El CSV se sirve en streaming porque no lleva binarios. El ZIP con todos los
// audios sí se registra como DataJob y lo genera el worker Python: el proceso
// HTTP nunca recorre ni empaqueta blobs.
//
// Réplica de qaExternaPersonasRouter (escritor con contrapresión, cabeceras
// diferidas, BOM). A la tercera copia, unificar en api/src/lib/csv.ts.

import { Router, Request, Response } from 'express';
import path from 'path';
import { ah } from '../lib/asyncHandler';
import { logger } from '../lib/logger';
import { requireRole, Roles } from '../middlewares/roleMiddleware';
import { validateQuery } from '../middlewares/validate';
import { ensureFound, parseId, parsePagination } from '../lib/http';
import { BadRequest, Conflict, NotFound } from '../middlewares/errorHandler';
import { sendPrivateFile } from '../lib/privateFileResponse';
import { rutaAbsolutaAudio } from '../lib/encuestasAudioStorage';
import {
  encuestasQuerySchema,
  EncuestasQueryInput,
  encuestasExportQuerySchema,
  EncuestasExportQueryInput,
} from '../validators/encuestasRevisionValidator';
import * as service from '../services/encuestasRevisionService';
import {
  createEncuestasExportJob,
  getLatestOwnedActiveDataJob,
  getOwnedDataJob,
  serializeDataJob,
} from '../services/dataJobService';
import { env } from '../config/env';

const router = Router();

router.get(
  '/',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(encuestasQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const q = req.query as unknown as EncuestasQueryInput;
    const result = await service.list({
      page,
      limit,
      dispositivo: q.dispositivo,
      estado: q.estado,
      conAudio: q.conAudio,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
    // El listado lleva preferencias electorales del encuestado: sin esta
    // cabecera, una 200 a un GET es heurísticamente cacheable y el botón
    // Atrás repintaría la lista desde el disco DESPUÉS de cerrar sesión. El
    // export.csv hermano ya la pone (setCsvHeaders).
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(result);
  }),
);

function csvFilename(q: EncuestasExportQueryInput): string {
  // En v3 no hay filtro de estado: el nombre lleva el rango de fechas y, si el
  // revisor exportó con el filtro de audio puesto, un sufijo que lo diga. Sin
  // él, dos descargas del mismo rango con conjuntos distintos llegan a la
  // carpeta con el mismo nombre y el navegador las apila como "(1)", "(2)".
  const sufijo = q.conAudio === undefined ? '' : q.conAudio ? '-con-audio' : '-sin-audio';
  return `encuestas-${q.dateFrom}_${q.dateTo}${sufijo}.csv`;
}

function setCsvHeaders(res: Response, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
}

/**
 * Escritor con contrapresión: si el socket va lleno, espera al 'drain' para no
 * acumular megas en el buffer del proceso cuando el revisor tiene la red lenta.
 * También despierta al cerrarse la conexión: si cancela la descarga, el 'drain'
 * no llegaría nunca y el generador quedaría colgado sosteniendo la consulta.
 *
 * Se registra UN solo par de listeners por respuesta, con un hueco rotativo para
 * el que espera, en vez de un `once('drain')` por lote: el middleware
 * `compression` (index.ts) reemplaza `res.on` para desviar los listeners de
 * 'drain' a su stream gzip interno pero NO `res.off`/`res.once`, así que un
 * listener por lote se acumula en el Gzip y Node acaba emitiendo
 * MaxListenersExceededWarning. Y NO se usa el callback de `res.write(chunk, cb)`:
 * el `res.write` de compression tiene firma `(chunk, encoding)` y descarta el
 * tercer argumento, así que con gzip activo —y `text/csv` es compresible— el
 * callback nunca se invoca y la exportación se colgaría.
 */
function crearEscritor(res: Response): (chunk: string) => Promise<void> {
  let pendiente: (() => void) | null = null;
  const despertar = (): void => {
    const resolver = pendiente;
    pendiente = null;
    if (resolver) resolver();
  };
  res.on('drain', despertar);
  res.on('close', despertar);

  return (chunk: string) =>
    res.write(chunk) ? Promise.resolve() : new Promise<void>((resolve) => { pendiente = resolve; });
}

// HEAD solo confirma cabeceras y filtros válidos (el navegador lo usa para
// resolver el nombre del archivo): no toca la BD.
router.head(
  '/export.csv',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(encuestasExportQuerySchema),
  ah(async (req: Request, res: Response) => {
    setCsvHeaders(res, csvFilename(req.query as unknown as EncuestasExportQueryInput));
    res.end();
  }),
);

router.get(
  '/export.csv',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(encuestasExportQuerySchema),
  ah(async (req: Request, res: Response) => {
    const q = req.query as unknown as EncuestasExportQueryInput;
    const escribir = crearEscritor(res);
    let abierto = false;

    /**
     * Cabeceras + BOM + fila de encabezados. NO se emiten hasta tener el primer
     * lote en mano: en cuanto sale el primer byte el 200 queda comprometido y
     * ningún fallo posterior puede convertirse ya en 5xx. Escribiéndolo antes,
     * un fallo de BD en la PRIMERA consulta entregaba un archivo con solo la fila
     * de encabezados y un 200 aparentemente normal — indistinguible de "no hay
     * datos" para el revisor.
     */
    const abrirArchivo = (): void => {
      setCsvHeaders(res, csvFilename(q));
      // BOM: sin él Excel en Windows abre el UTF-8 como latin-1 y parte los acentos.
      res.write('\uFEFF' + service.ENCUESTAS_CSV_HEADERS.join(',') + '\r\n');
      abierto = true;
    };

    try {
      for await (const lote of service.iterateForExport({
        dispositivo: q.dispositivo,
        estado: q.estado,
        conAudio: q.conAudio,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
      })) {
        if (res.destroyed) break;
        if (!abierto) abrirArchivo();
        await escribir(lote.map(service.toCsvRow).join(''));
      }
    } catch (e) {
      // Todavía no ha salido ni un byte: se relanza para que el errorHandler
      // responda un 500 honesto en vez de un CSV truncado con 200.
      if (!abierto) throw e;
      // A media descarga NO hay arreglo dentro de HTTP/1.1: el 200 y las cabeceras
      // ya viajaron, un res.status(500) lanzaría ERR_HTTP_HEADERS_SENT y el
      // estándar solo permite señalar el fallo con trailers, que ni Excel ni el
      // navegador leen. Se registra y se cierra el archivo truncado: el revisor ve
      // un CSV incompleto, no una descarga colgada. Quien automatice la descarga
      // debe comparar las filas obtenidas contra el `total` del listado, que es la
      // única señal fiable de integridad. Se registra la ruta, nunca los datos.
      logger.error({ err: e, path: req.path }, 'Exportación CSV de encuestas interrumpida');
    }
    // Conjunto vacío: se entrega igualmente BOM + encabezados con 200, que es un CSV
    // vacío legítimo. Si la conexión ya murió, no se escribe nada.
    if (!abierto && !res.destroyed) abrirArchivo();
    res.end();
  }),
);

const downloadEncuestasExport = ah(async (req: Request, res: Response) => {
  const id = parseId(req, 'jobId');
  const job = await getOwnedDataJob(id, req.user!.userId, 'ENCUESTAS_EXPORT');
  if (job.status !== 'COMPLETED') throw Conflict('La exportación aún no está lista');
  if (job.expiresAt <= new Date()) throw NotFound('Exportación');
  if (!job.artifactPath || !job.artifactName) throw NotFound('Archivo de exportación');

  const baseDir = path.resolve(env.REPORTS_DIR, 'data-jobs');
  const safePath = path.resolve(baseDir, path.basename(job.artifactPath));
  if (!safePath.startsWith(baseDir + path.sep)) throw BadRequest('Ruta de artefacto inválida');
  const sent = await sendPrivateFile(req, res, safePath, {
    contentType: 'application/zip',
    downloadName: job.artifactName,
    cacheControl: 'private, no-store',
  });
  if (!sent) throw NotFound('Archivo de exportación');
});

router.post(
  '/exports',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(encuestasExportQuerySchema),
  ah(async (req: Request, res: Response) => {
    const q = req.query as unknown as EncuestasExportQueryInput;
    const dateFrom = new Date(`${q.dateFrom}T00:00:00.000Z`);
    const dateToExclusive = new Date(`${q.dateTo}T00:00:00.000Z`);
    dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
    const job = await createEncuestasExportJob({
      requestedById: req.user!.userId,
      dateFrom,
      dateToExclusive,
      dateTo: q.dateTo,
      maxRecords: service.MAX_ENCUESTAS_EXPORT,
      dispositivo: q.dispositivo,
      estado: q.estado,
      conAudio: q.conAudio,
    });
    res.status(202).json({ data: serializeDataJob(job) });
  }),
);

router.get(
  '/exports/active',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const job = await getLatestOwnedActiveDataJob(req.user!.userId, 'ENCUESTAS_EXPORT');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: job ? serializeDataJob(job) : null });
  }),
);

router.get(
  '/exports/:jobId',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const job = await getOwnedDataJob(
      parseId(req, 'jobId'),
      req.user!.userId,
      'ENCUESTAS_EXPORT',
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: serializeDataJob(job) });
  }),
);

router.head(
  '/exports/:jobId/download',
  requireRole([Roles.REVISOR_QA]),
  downloadEncuestasExport,
);
router.get(
  '/exports/:jobId/download',
  requireRole([Roles.REVISOR_QA]),
  downloadEncuestasExport,
);

// ─── Detalle y audios ────────────────────────────────────────────────────────
// Van al final a propósito: `/:id` registrado antes de `/export.csv` se comería
// esa ruta (parseId('export.csv') → 400) y mataría la exportación.

router.get(
  '/:id',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const encuesta = ensureFound(await service.getById(parseId(req)), 'Encuesta');
    // Mismo motivo que en el listado: el detalle lleva las respuestas políticas
    // del encuestado y no puede quedar en el disco del navegador.
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(encuesta);
  }),
);

/**
 * Stream del segmento (voz de personas encuestadas: dato personal, mismo rol que
 * el resto). `Range` para que el <audio> del navegador pueda buscar;
 * `no-transform` para que ningún intermediario recomprima un tramo.
 * `?download=1` añade Content-Disposition con un nombre útil.
 */
const servirAudio = ah(async (req: Request, res: Response) => {
  const encuestaId = parseId(req);
  const audioId = parseId(req, 'audioId');
  const audio = ensureFound(await service.getAudioParaServir(encuestaId, audioId), 'Audio');
  const descargar = req.query.download === '1';
  const sent = await sendPrivateFile(req, res, rutaAbsolutaAudio(audio.ruta), {
    contentType: service.contentTypeDeAudio(audio.mimeDeclarado),
    cacheControl: 'private, max-age=3600, must-revalidate, no-transform',
    varyCookie: true,
    acceptRanges: true,
    downloadName: descargar ? `${audio.idLocal}-${audio.segmento}` : undefined,
  });
  // La fila existe pero el blob no está en disco: para el revisor es un 404, no
  // un 500 — y no se filtra la ruta del archivo en la respuesta.
  if (!sent) throw NotFound('Audio');
});
// HEAD antes que GET solo por orden de lectura: son la misma función y
// sendPrivateFile ya distingue el método (HEAD no mueve el cuerpo).
router.head('/:id/audios/:audioId', requireRole([Roles.REVISOR_QA]), servirAudio);
router.get('/:id/audios/:audioId', requireRole([Roles.REVISOR_QA]), servirAudio);

export default router;

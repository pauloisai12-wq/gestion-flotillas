// Router de lectura del "registro de personas" (lado REVISOR_QA). Va montado en
// /api/qa-externa-personas y NO como subruta de /api/qa-externa/*, que pertenece
// al router de ingesta con guard por API key: mezclarlos dejaría el listado tras
// una autenticación de dispositivo, no de revisor.
//
// La exportación se sirve en streaming (lote a lote) en vez de registrarse como
// DataJob: un CSV sin imágenes cabe de sobra en una respuesta HTTP, y el tope de
// filas del servicio impide que crezca sin límite.

import { Router, Request, Response } from 'express';
import { ah } from '../lib/asyncHandler';
import { logger } from '../lib/logger';
import { requireRole, Roles } from '../middlewares/roleMiddleware';
import { validateQuery } from '../middlewares/validate';
import { parsePagination } from '../lib/http';
import {
  qaPersonasQuerySchema,
  QaPersonasQueryInput,
  qaPersonasExportQuerySchema,
  QaPersonasExportQueryInput,
} from '../validators/qaExternaPersonasValidator';
import * as service from '../services/qaExternaPersonasService';

const router = Router();

router.get(
  '/',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(qaPersonasQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const q = req.query as unknown as QaPersonasQueryInput;
    const result = await service.list({
      page,
      limit,
      programa: q.programa,
      dispositivo: q.dispositivo,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      q: q.q,
    });
    // El listado va con nombre y teléfono de cada persona: sin esta cabecera,
    // una 200 a un GET es heurísticamente cacheable y el botón Atrás repintaría
    // la lista desde el disco DESPUÉS de cerrar sesión. El export.csv hermano ya
    // la pone (setCsvHeaders).
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(result);
  }),
);

function csvFilename(q: QaPersonasExportQueryInput): string {
  const programa = q.programa ? q.programa.toLowerCase() : 'todos';
  return `personas-${programa}-${q.dateFrom}_${q.dateTo}.csv`;
}

function setCsvHeaders(res: Response, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
}

/**
 * Escritor con contrapresión: si el socket va lleno, espera al 'drain' para no
 * acumular megas en el buffer del proceso cuando el revisor tiene la VPN lenta.
 * También despierta al cerrarse la conexión: si cancela la descarga, el 'drain'
 * no llegaría nunca y el generador quedaría colgado sosteniendo la consulta.
 *
 * Se registra UN solo par de listeners por respuesta, con un hueco rotativo para
 * el que espera, en vez de un `once('drain')` por lote. Motivo: el middleware
 * `compression` (index.ts:135-144) reemplaza `res.on` para desviar los listeners
 * de 'drain' hacia su stream gzip interno, pero NO reemplaza `res.off`/`res.once`
 * — el envoltorio de `once` se autoborra de `res`, donde nunca estuvo, y el
 * `res.off('drain')` era un no-op. Con un listener por lote, una descarga de
 * 50 000 filas los acumulaba en el Gzip: medido, al 11º ciclo de contrapresión
 * Node emite `MaxListenersExceededWarning`.
 *
 * Y NO se usa el callback de `res.write(chunk, cb)`: el `res.write` de
 * compression@1.8.1 tiene firma `(chunk, encoding)` y descarta el tercer
 * argumento, así que con gzip activo — que es el caso, `text/csv` es
 * compresible — el callback NUNCA se invoca y la exportación se colgaría.
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
  validateQuery(qaPersonasExportQuerySchema),
  ah(async (req: Request, res: Response) => {
    setCsvHeaders(res, csvFilename(req.query as unknown as QaPersonasExportQueryInput));
    res.end();
  }),
);

router.get(
  '/export.csv',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(qaPersonasExportQuerySchema),
  ah(async (req: Request, res: Response) => {
    const q = req.query as unknown as QaPersonasExportQueryInput;
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
      res.write('\uFEFF' + service.QA_PERSONAS_CSV_HEADERS.join(',') + '\r\n');
      abierto = true;
    };

    try {
      for await (const lote of service.iterateForExport({
        programa: q.programa,
        dispositivo: q.dispositivo,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        q: q.q,
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
      // única señal fiable de integridad.
      logger.error({ err: e, path: req.path }, 'Exportación CSV de personas interrumpida');
    }
    // Conjunto vacío: se entrega igualmente BOM + encabezados con 200, que es un CSV
    // vacío legítimo. Si la conexión ya murió, no se escribe nada.
    if (!abierto && !res.destroyed) abrirArchivo();
    res.end();
  }),
);

export default router;

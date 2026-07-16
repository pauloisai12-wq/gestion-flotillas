// Router de revisión QA. Exportaciones grandes se registran como DataJob y se
// procesan por lotes en el worker Python; ninguna petición materializa el XLSX.

import { Router, Request, Response } from 'express';
import path from 'path';
import { ah } from '../lib/asyncHandler';
import { sendPrivateFile } from '../lib/privateFileResponse';
import { requireRole, Roles } from '../middlewares/roleMiddleware';
import { validateQuery } from '../middlewares/validate';
import { parseId, parsePagination } from '../lib/http';
import { BadRequest, Conflict, NotFound } from '../middlewares/errorHandler';
import {
  qaExportQuerySchema,
  QaExportQueryInput,
  qaRegistrosQuerySchema,
  QaRegistrosQueryInput,
} from '../validators/qaExternaRegistrosValidator';
import * as service from '../services/qaExternaRegistrosService';
import {
  createQaExportJob,
  getLatestOwnedActiveDataJob,
  getOwnedDataJob,
  serializeDataJob,
} from '../services/dataJobService';
import { env } from '../config/env';
import {
  enqueueQaThumbnail,
  qaThumbnailPath,
} from '../services/mediaThumbnailService';

const router = Router();
export const MAX_QA_EXPORT_RECORDS = 50_000;

const serveQaThumbnail = ah(async (req: Request, res: Response) => {
  const { programa, sha256 } = req.params;
  if (programa !== 'BUFFALO' && programa !== 'LX') throw BadRequest('Programa inválido');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw BadRequest('Hash inválido');
  const thumbnailPath = qaThumbnailPath(programa, sha256);
  const sent = await sendPrivateFile(req, res, thumbnailPath, {
    contentType: 'image/webp',
    cacheControl: 'private, max-age=3600, must-revalidate',
    varyCookie: true,
  });
  if (sent) return;

  await enqueueQaThumbnail(programa, sha256);
  res.setHeader('Retry-After', '3');
  res.status(404).json({ error: 'Miniatura en proceso', code: 'THUMBNAIL_PENDING' });
});

const serveQaImage = ah(async (req: Request, res: Response) => {
  const { programa, sha256 } = req.params;
  if (programa !== 'BUFFALO' && programa !== 'LX') throw BadRequest('Programa inválido');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw BadRequest('Hash inválido');

  const sub = programa === 'BUFFALO' ? 'buffalo' : 'lx';
  const baseDir = path.resolve(env.QA_EXTERNA_DIR, sub);
  const safePath = path.resolve(baseDir, path.basename(`${sha256}.jpg`)); // nosemgrep
  if (!safePath.startsWith(baseDir + path.sep)) throw BadRequest('Ruta inválida');
  const sent = await sendPrivateFile(req, res, safePath, {
    contentType: 'image/jpeg',
    cacheControl: 'private, max-age=3600, must-revalidate',
    varyCookie: true,
  });
  if (!sent) throw NotFound('Imagen');
});

const downloadQaExport = ah(async (req: Request, res: Response) => {
  const id = parseId(req, 'jobId');
  const job = await getOwnedDataJob(id, req.user!.userId, 'QA_EXPORT');
  if (job.status !== 'COMPLETED') throw Conflict('La exportación aún no está lista');
  if (job.expiresAt <= new Date()) throw NotFound('Exportación');
  if (!job.artifactPath || !job.artifactName) throw NotFound('Archivo de exportación');

  const baseDir = path.resolve(env.REPORTS_DIR, 'data-jobs');
  const safePath = path.resolve(baseDir, path.basename(job.artifactPath));
  if (!safePath.startsWith(baseDir + path.sep)) throw BadRequest('Ruta de artefacto inválida');
  const sent = await sendPrivateFile(req, res, safePath, {
    downloadName: job.artifactName,
    cacheControl: 'private, no-store',
  });
  if (!sent) throw NotFound('Archivo de exportación');
});

router.get(
  '/',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(qaRegistrosQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const q = req.query as unknown as QaRegistrosQueryInput;
    const result = await service.list({
      page,
      limit,
      tipo: q.tipo,
      programa: q.programa,
      dispositivo: q.dispositivo,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
    res.json(result);
  }),
);

router.head(
  '/imagenes/:programa/:sha256/thumbnail',
  requireRole([Roles.REVISOR_QA]),
  serveQaThumbnail,
);
router.get(
  '/imagenes/:programa/:sha256/thumbnail',
  requireRole([Roles.REVISOR_QA]),
  serveQaThumbnail,
);

router.head(
  '/imagenes/:programa/:sha256',
  requireRole([Roles.REVISOR_QA]),
  serveQaImage,
);
router.get(
  '/imagenes/:programa/:sha256',
  requireRole([Roles.REVISOR_QA]),
  serveQaImage,
);

// Crea una exportación acotada. El rango obligatorio impide pedir todo el
// histórico accidentalmente; el worker aplica además el límite de registros.
router.post(
  '/exports',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(qaExportQuerySchema),
  ah(async (req: Request, res: Response) => {
    const q = req.query as unknown as QaExportQueryInput;
    const dateFrom = new Date(`${q.dateFrom}T00:00:00.000Z`);
    const dateToExclusive = new Date(`${q.dateTo}T00:00:00.000Z`);
    dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);

    const job = await createQaExportJob({
      requestedById: req.user!.userId,
      programa: q.programa,
      dateFrom,
      dateToExclusive,
      maxRecords: MAX_QA_EXPORT_RECORDS,
    });
    res.status(202).json({ data: serializeDataJob(job) });
  }),
);

router.get(
  '/exports/active',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const job = await getLatestOwnedActiveDataJob(req.user!.userId, 'QA_EXPORT');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: job ? serializeDataJob(job) : null });
  }),
);

router.get(
  '/exports/:jobId',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req, 'jobId');
    const job = await getOwnedDataJob(id, req.user!.userId, 'QA_EXPORT');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: serializeDataJob(job) });
  }),
);

router.head(
  '/exports/:jobId/download',
  requireRole([Roles.REVISOR_QA]),
  downloadQaExport,
);
router.get(
  '/exports/:jobId/download',
  requireRole([Roles.REVISOR_QA]),
  downloadQaExport,
);

export default router;

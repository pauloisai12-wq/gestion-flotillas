// Importación asíncrona de Excel/CSV. La petición solo valida y persiste el
// archivo; BullMQ procesa el libro fuera del ciclo HTTP y publica progreso.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { BadRequest } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { logger } from '../lib/logger';
import { parseId } from '../lib/http';
import {
  cleanupUploadedFilesOnError,
  UPLOAD_DIRS,
  uploadRateLimit,
} from '../lib/uploadStorage';
import {
  createVehicleImportJob,
  getLatestOwnedActiveDataJob,
  getOwnedDataJob,
  serializeDataJob,
} from '../services/dataJobService';

const router = Router();
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_VEHICLE_IMPORT_ROWS = 10_000;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIRS.vehicleImports),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      return cb(new Error('Solo se permiten .xlsx, .xls o .csv'));
    }
    cb(null, true);
  },
});

const ALLOWED_EXTS = new Set(['xlsx', 'xls', 'csv', 'zip', 'cfb']);

async function readSample(filePath: string, length = 8192): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

router.post(
  '/import',
  requireRole(RoleGroups.VEHICLE_WRITERS),
  uploadRateLimit,
  upload.single('file'),
  ah(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) return next(BadRequest('Sube un archivo en el campo "file"'));

    const sample = await readSample(req.file.path);
    const { fileTypeFromBuffer } = await import('file-type');
    const type = await fileTypeFromBuffer(sample);
    const isCsv = !type && /[,;\t]/.test(sample.toString('utf8'));

    if (!isCsv && (!type || !ALLOWED_EXTS.has(type.ext))) {
      logger.warn(
        { detected: type?.ext, mime: req.file.mimetype, size: req.file.size },
        'Archivo de importación rechazado por magic bytes',
      );
      throw BadRequest('El archivo no parece ser un Excel/CSV válido');
    }
    if (req.file.size < 50) throw BadRequest('Archivo demasiado pequeño');

    const job = await createVehicleImportJob({
      requestedById: req.user!.userId,
      inputPath: req.file.path,
      originalFileName: req.file.originalname,
      maxRows: MAX_VEHICLE_IMPORT_ROWS,
    });
    res.status(202).json({ data: serializeDataJob(job) });
  }),
  cleanupUploadedFilesOnError,
);

router.get(
  '/import/active',
  requireRole(RoleGroups.VEHICLE_WRITERS),
  ah(async (req: Request, res: Response) => {
    const job = await getLatestOwnedActiveDataJob(req.user!.userId, 'VEHICLE_IMPORT');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: job ? serializeDataJob(job) : null });
  }),
);

router.get(
  '/import/:jobId',
  requireRole(RoleGroups.VEHICLE_WRITERS),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req, 'jobId');
    const job = await getOwnedDataJob(id, req.user!.userId, 'VEHICLE_IMPORT');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: serializeDataJob(job) });
  }),
);

export default router;

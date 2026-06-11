// Import de Excel/CSV con validación de magic bytes (no solo MIME type)

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
// `file-type` v18+ es ESM puro y el proyecto compila con `module: commonjs`,
// así que usamos dynamic import en lugar de un require/import sincrónico
// (que falla en typecheck y en runtime).
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { importVehiclesFromBuffer } from '../services/vehicleImportService';
import { BadRequest } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { logger } from '../lib/logger';

const router = Router();

// Multer en memoria, max 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      return cb(new Error('Solo se permiten .xlsx, .xls o .csv'));
    }
    cb(null, true);
  },
});

const ALLOWED_EXTS = new Set(['xlsx', 'xls', 'csv', 'zip']); // xlsx internamente es zip

router.post(
  '/import',
  requireRole(RoleGroups.VEHICLE_WRITERS),
  upload.single('file'),
  ah(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) return next(BadRequest('Sube un archivo en el campo "file"'));

    // Validar MAGIC BYTES (no confiar en mimetype/extensión)
    const { fileTypeFromBuffer } = await import('file-type');
    const type = await fileTypeFromBuffer(req.file.buffer);
    const isCsv = !type && /[,;\t]/.test(req.file.buffer.toString('utf8', 0, 200));

    if (!isCsv && (!type || !ALLOWED_EXTS.has(type.ext))) {
      logger.warn(
        { detected: type?.ext, mime: req.file.mimetype, size: req.file.size },
        'Archivo rechazado por magic bytes',
      );
      return next(BadRequest('El archivo no parece ser un Excel/CSV válido'));
    }

    // Rechazar archivos sospechosamente pequeños o vacíos
    if (req.file.size < 50) {
      return next(BadRequest('Archivo demasiado pequeño'));
    }

    const result = await importVehiclesFromBuffer(req.file.buffer);
    res.json({ data: result });
  }),
);

export default router;


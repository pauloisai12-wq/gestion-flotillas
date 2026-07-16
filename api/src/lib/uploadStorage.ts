import { accessSync, constants, mkdirSync, promises as fs } from 'fs';
import path from 'path';
import type { ErrorRequestHandler, Request } from 'express';
import { logger } from './logger';
import { getClientIp, rateLimit } from '../middlewares/rateLimit';

export const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');

export const UPLOAD_DIRS = {
  documents: path.join(UPLOADS_ROOT, 'documents'),
  maintenance: path.join(UPLOADS_ROOT, 'maintenance'),
  maintenanceTicketPhotos: path.join(UPLOADS_ROOT, 'maintenance-tickets', 'photos'),
  maintenanceTicketThumbnails: path.join(UPLOADS_ROOT, 'maintenance-tickets', 'thumbnails'),
  maintenanceTicketQuotes: path.join(UPLOADS_ROOT, 'maintenance-tickets', 'quotes'),
  qaExternaBuffalo: path.join(UPLOADS_ROOT, 'qa-externa', 'buffalo'),
  qaExternaLx: path.join(UPLOADS_ROOT, 'qa-externa', 'lx'),
  qaExternaThumbnailsBuffalo: path.join(UPLOADS_ROOT, 'qa-externa', 'thumbnails', 'buffalo'),
  qaExternaThumbnailsLx: path.join(UPLOADS_ROOT, 'qa-externa', 'thumbnails', 'lx'),
  vehicleImports: path.join(UPLOADS_ROOT, 'vehicle-imports'),
} as const;

/**
 * Crea el árbol completo usado por los diskStorage y comprueba que el usuario
 * del proceso puede escribirlo. Debe ejecutarse antes de aceptar conexiones.
 */
export function ensureUploadDirectories(): void {
  for (const directory of Object.values(UPLOAD_DIRS)) {
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
  }
}

function getUploadedFiles(req: Request): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files).flat();
}

function isInsideUploads(filePath: string): boolean {
  const relative = path.relative(UPLOADS_ROOT, path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Elimina exclusivamente archivos que Multer haya guardado bajo UPLOADS_ROOT. */
export async function removeUploadedFiles(req: Request): Promise<void> {
  await Promise.all(
    getUploadedFiles(req).map(async (file) => {
      if (!file.path || !isInsideUploads(file.path)) {
        logger.error({ uploadPath: file.path }, 'Se rechazó limpiar un archivo fuera de uploads');
        return;
      }

      try {
        await fs.unlink(file.path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.error({ err, uploadPath: file.path }, 'No se pudo limpiar un upload fallido');
        }
      }
    }),
  );
}

/**
 * Error middleware local para colocarlo al final de cada cadena multipart.
 * Espera la limpieza antes de delegar al error handler global.
 */
export const cleanupUploadedFilesOnError: ErrorRequestHandler = (err, req, _res, next) => {
  void removeUploadedFiles(req).then(() => next(err));
};

/** Bucket compartido por usuario para limitar escrituras a disco vía multipart. */
export const uploadRateLimit = rateLimit({
  max: 20,
  windowSec: 60,
  keyBuilder: (req) =>
    req.user?.userId != null
      ? `upload:user:${req.user.userId}`
      : `upload:ip:${getClientIp(req)}`,
  message: 'Demasiados archivos enviados. Espera un minuto e intenta de nuevo.',
  failClosed: true,
});

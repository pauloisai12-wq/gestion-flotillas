import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { documentSchema } from '../validators/documentValidator';
import * as documentService from '../services/documentService';
import { roleMiddleware, RoleGroups } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { parseId } from '../lib/http';
import { BadRequest } from '../middlewares/errorHandler';
import {
  cleanupUploadedFilesOnError,
  UPLOAD_DIRS,
  uploadRateLimit,
} from '../lib/uploadStorage';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIRS.documents);
  },
  filename: (_req, file, cb) => {
    // Renombrado seguro: UUID + extensión normalizada (ya validada por fileFilter).
    // El nombre original del cliente nunca toca el filesystem.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 5,
    parts: 6,
    fieldSize: 64 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Use PDF, JPG, PNG o WEBP.'));
    }
  },
});

const router = Router();

router.get('/vehicles/:vehicleId/documents', roleMiddleware(RoleGroups.VEHICLE_READERS), ah(async (req: Request, res: Response) => {
  const vehicleId = parseId(req, 'vehicleId');
  const docs = await documentService.getDocumentsByVehicle(vehicleId);
  res.json(docs);
}));

router.get('/documents/:id', roleMiddleware(RoleGroups.VEHICLE_READERS), ah(async (req: Request, res: Response) => {
  const id = parseId(req);
  const doc = await documentService.getDocumentById(id);
  res.json(doc);
}));

router.post(
  '/documents',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  uploadRateLimit,
  upload.single('file'),
  ah(async (req: Request, res: Response) => {
    // Multipart: tras multer los campos llegan como texto, por eso el armado
    // manual del body antes del safeParse (validateBody no aplica aquí).
    const body = {
      vehicleId: parseInt(req.body.vehicleId),
      type: req.body.type,
      issuedAt: req.body.issuedAt,
      expiresAt: req.body.expiresAt,
      notes: req.body.notes || null,
    };

    const parsed = documentSchema.safeParse(body);
    if (!parsed.success) {
      throw BadRequest(
        'Datos inválidos',
        parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      );
    }

    const file = req.file
      ? { filename: req.file.filename, originalname: req.file.originalname }
      : undefined;

    const doc = await documentService.createDocument(parsed.data, file);
    res.status(201).json(doc);
  }),
  cleanupUploadedFilesOnError,
);

router.put(
  '/documents/:id',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  uploadRateLimit,
  upload.single('file'),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);

    // Multipart: tras multer los campos llegan como texto, por eso el armado
    // manual del body antes del safeParse (validateBody no aplica aquí).
    const body = {
      vehicleId: parseInt(req.body.vehicleId),
      type: req.body.type,
      issuedAt: req.body.issuedAt,
      expiresAt: req.body.expiresAt,
      notes: req.body.notes || null,
    };

    const parsed = documentSchema.safeParse(body);
    if (!parsed.success) {
      throw BadRequest(
        'Datos inválidos',
        parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      );
    }

    const file = req.file
      ? { filename: req.file.filename, originalname: req.file.originalname }
      : undefined;

    const doc = await documentService.updateDocument(id, parsed.data, file);
    res.json(doc);
  }),
  cleanupUploadedFilesOnError,
);

router.delete(
  '/documents/:id',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    await documentService.deleteDocument(id);
    res.json({ message: 'Documento eliminado correctamente' });
  })
);

export default router;

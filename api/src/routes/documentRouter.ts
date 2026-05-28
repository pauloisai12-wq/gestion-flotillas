import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { documentSchema } from '../validators/documentValidator';
import * as documentService from '../services/documentService';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/documents'));
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
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
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

router.get('/vehicles/:vehicleId/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'ID inválido' });
    const docs = await documentService.getDocumentsByVehicle(vehicleId);
    res.json(docs);
  } catch (error) {
    next(error);
    }
});

router.get('/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const doc = await documentService.getDocumentById(id);
    res.json(doc);
  } catch (error) {
    next(error);
    }
});

router.post(
  '/documents',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = {
        vehicleId: parseInt(req.body.vehicleId),
        type: req.body.type,
        issuedAt: req.body.issuedAt,
        expiresAt: req.body.expiresAt,
        notes: req.body.notes || null,
      };

      const parsed = documentSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const file = req.file
        ? { filename: req.file.filename, originalname: req.file.originalname }
        : undefined;

      const doc = await documentService.createDocument(parsed.data, file);
      res.status(201).json(doc);
    } catch (error) {
      next(error);
      }
  }
);

router.put(
  '/documents/:id',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

      const body = {
        vehicleId: parseInt(req.body.vehicleId),
        type: req.body.type,
        issuedAt: req.body.issuedAt,
        expiresAt: req.body.expiresAt,
        notes: req.body.notes || null,
      };

      const parsed = documentSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const file = req.file
        ? { filename: req.file.filename, originalname: req.file.originalname }
        : undefined;

      const doc = await documentService.updateDocument(id, parsed.data, file);
      res.json(doc);
    } catch (error) {
      next(error);
      }
  }
);

router.delete(
  '/documents/:id',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
      await documentService.deleteDocument(id);
      res.json({ message: 'Documento eliminado correctamente' });
    } catch (error) {
      next(error);
      }
  }
);

export default router;
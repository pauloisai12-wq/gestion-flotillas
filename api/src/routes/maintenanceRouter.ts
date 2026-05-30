// api/src/routes/maintenanceRouter.ts
// Endpoints para registros de mantenimiento y consulta de próximos servicios.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { maintenanceSchema } from '../validators/maintenanceValidator';
import * as maintenanceRecordService from '../services/maintenanceRecordService';
import { getUpcomingServices, getAllPendingServices } from '../services/maintenanceService';

// Configuración de multer para evidencia fotográfica.
// SEGURIDAD: el nombre original del cliente NUNCA toca el filesystem (evita
// path traversal y extensiones maliciosas). Renombrado a UUID + extensión
// normalizada, ya validada por fileFilter (mismo patrón que documentRouter).
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

const storage = multer.diskStorage({
  destination: function(_req, _file, cb) {
    cb(null, path.join(__dirname, '../../uploads/maintenance'));
  },
  filename: function(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: function(_req, file, cb) {
    // Validar por EXTENSIÓN del originalname (no por mimetype, que es
    // controlable por el cliente): así la extensión guardada queda en allowlist.
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo JPG, PNG, WEBP o PDF.'));
    }
  },
});

const router = Router();

// GET /api/maintenance/pending — Todos los servicios pendientes (WARNING + OVERDUE)
router.get('/pending', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const pending = await getAllPendingServices();
    res.json({ data: pending });
  } catch (error) {
    next(error);
    }
});

// GET /api/maintenance/upcoming/:vehicleId — Próximos servicios de un vehículo
router.get('/upcoming/:vehicleId', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'ID inválido' });

    const services = await getUpcomingServices(vehicleId);
    res.json({ data: services });
  } catch (error) {
    next(error);
    }
});

// GET /api/maintenance — Lista paginada de registros
router.get('/', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const query = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      vehicleId: req.query.vehicleId ? parseInt(req.query.vehicleId as string) : undefined,
      serviceId: req.query.serviceId ? parseInt(req.query.serviceId as string) : undefined,
    };

    const result = await maintenanceRecordService.getAll(query);
    res.json(result);
  } catch (error) {
    next(error);
    }
});

// GET /api/maintenance/vehicle/:vehicleId — Historial de un vehículo
router.get('/vehicle/:vehicleId', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'ID inválido' });

    const records = await maintenanceRecordService.getByVehicle(vehicleId);
    res.json({ data: records });
  } catch (error) {
    next(error);
    }
});

// POST /api/maintenance — Registrar mantenimiento (ADMIN, SUPERVISOR)
router.post('/', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), upload.single('evidence'), async function(req: Request, res: Response, next: NextFunction) {
  try {
    // multer pone los campos de texto en req.body como strings, hay que parsear números
    const body = {
      vehicleId: parseInt(req.body.vehicleId),
      serviceId: parseInt(req.body.serviceId),
      odometer: parseFloat(req.body.odometer),
      cost: parseFloat(req.body.cost),
      provider: req.body.provider,
      workshop: req.body.workshop,
      serviceDate: req.body.serviceDate,
      notes: req.body.notes,
    };

    const parsed = maintenanceSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map(function(i) {
          return { field: i.path.join('.'), message: i.message };
        }),
      });
    }

    const evidenceUrl = req.file ? '/uploads/maintenance/' + req.file.filename : undefined;
    const record = await maintenanceRecordService.create(parsed.data, evidenceUrl);
    res.status(201).json({ data: record });
  } catch (error) {
    next(error);
    }
});

// PUT /api/maintenance/:id — Actualizar registro (ADMIN, SUPERVISOR)
router.put('/:id', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), upload.single('evidence'), async function(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const body = {
      vehicleId: parseInt(req.body.vehicleId),
      serviceId: parseInt(req.body.serviceId),
      odometer: parseFloat(req.body.odometer),
      cost: parseFloat(req.body.cost),
      provider: req.body.provider,
      workshop: req.body.workshop,
      serviceDate: req.body.serviceDate,
      notes: req.body.notes,
    };

    const parsed = maintenanceSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map(function(i) {
          return { field: i.path.join('.'), message: i.message };
        }),
      });
    }

    const evidenceUrl = req.file ? '/uploads/maintenance/' + req.file.filename : undefined;
    const record = await maintenanceRecordService.update(id, parsed.data, evidenceUrl);
    res.json({ data: record });
  } catch (error) {
    next(error);
    }
});

// DELETE /api/maintenance/:id — Eliminar registro (ADMIN)
router.delete('/:id', roleMiddleware(['ADMIN']), async function(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    await maintenanceRecordService.remove(id);
    res.json({ message: 'Registro eliminado correctamente' });
  } catch (error) {
    next(error);
    }
});

export default router;
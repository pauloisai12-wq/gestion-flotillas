// Endpoints para registros de mantenimiento y consulta de próximos servicios.

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  maintenanceSchema,
  listMaintenanceQuerySchema,
  ListMaintenanceQuery,
} from '../validators/maintenanceValidator';
import * as maintenanceRecordService from '../services/maintenanceRecordService';
import { getUpcomingServices, getAllPendingServices } from '../services/maintenanceService';
import { ah } from '../lib/asyncHandler';
import { validateQuery } from '../middlewares/validate';
import { parseId } from '../lib/http';

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
router.get('/pending', ah(async function(_req: Request, res: Response) {
  const pending = await getAllPendingServices();
  res.json({ data: pending });
}));

// GET /api/maintenance/upcoming/:vehicleId — Próximos servicios de un vehículo
router.get('/upcoming/:vehicleId', ah(async function(req: Request, res: Response) {
  const vehicleId = parseId(req, 'vehicleId');
  const services = await getUpcomingServices(vehicleId);
  res.json({ data: services });
}));

// GET /api/maintenance — Lista paginada de registros
router.get('/', validateQuery(listMaintenanceQuerySchema), ah(async function(req: Request, res: Response) {
  const result = await maintenanceRecordService.getAll(req.query as unknown as ListMaintenanceQuery);
  res.json(result);
}));

// GET /api/maintenance/vehicle/:vehicleId — Historial de un vehículo
router.get('/vehicle/:vehicleId', ah(async function(req: Request, res: Response) {
  const vehicleId = parseId(req, 'vehicleId');
  const records = await maintenanceRecordService.getByVehicle(vehicleId);
  res.json({ data: records });
}));

// POST /api/maintenance — Registrar mantenimiento (ADMIN, SUPERVISOR)
// NOTA: se conserva el safeParse inline (no validateBody) porque multer entrega
// los campos como strings y el schema no es coercitivo: hay que parsear números antes.
router.post('/', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), upload.single('evidence'), ah(async function(req: Request, res: Response) {
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
}));

// PUT /api/maintenance/:id — Actualizar registro (ADMIN, SUPERVISOR)
router.put('/:id', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), upload.single('evidence'), ah(async function(req: Request, res: Response) {
  const id = parseId(req);

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
}));

// DELETE /api/maintenance/:id — Eliminar registro (ADMIN)
router.delete('/:id', roleMiddleware(['ADMIN']), ah(async function(req: Request, res: Response) {
  const id = parseId(req);
  await maintenanceRecordService.remove(id);
  res.json({ message: 'Registro eliminado correctamente' });
}));

export default router;
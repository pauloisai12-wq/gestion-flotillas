// Archivo: /flotillas/api/src/routes/vehicleRouter.ts
// NUEVO: Endpoints REST para vehículos
import { Router, Request, Response, NextFunction } from 'express';
import { vehicleSchema } from '../validators/vehicleValidator';
import * as vehicleService from '../services/vehicleService';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

/**
 * GET /api/vehicles
 * Lista paginada con filtros. Acceso: todos los roles autenticados.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      search: req.query.search as string | undefined,
      vehicleTypeId: req.query.vehicleTypeId
        ? parseInt(req.query.vehicleTypeId as string)
        : undefined,
      status: req.query.status as string | undefined,
      executorId: req.query.executorId
        ? parseInt(req.query.executorId as string)
        : undefined,
    };

    const result = await vehicleService.getAllVehicles(query);
    res.json(result);
  } catch (error) {
    next(error);
    }
});

/**
 * GET /api/vehicles/:id
 * Detalle de un vehículo con relaciones.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const vehicle = await vehicleService.getVehicleById(id);
    res.json(vehicle);
  } catch (error) {
    next(error);
    }
});

/**
 * POST /api/vehicles
 * Crear vehículo. Acceso: ADMIN, SUPERVISOR.
 */
router.post(
  '/',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = vehicleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const vehicle = await vehicleService.createVehicle(parsed.data);
      res.status(201).json(vehicle);
    } catch (error) {
      next(error);
      }
  }
);

/**
 * PUT /api/vehicles/:id
 * Actualizar vehículo. Acceso: ADMIN, SUPERVISOR.
 */
router.put(
  '/:id',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'ID inválido' });
      }

      const parsed = vehicleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const vehicle = await vehicleService.updateVehicle(id, parsed.data);
      res.json(vehicle);
    } catch (error) {
      next(error);
      }
  }
);

/**
 * DELETE /api/vehicles/:id
 * Eliminar vehículo. Acceso: Solo ADMIN.
 */
router.delete(
  '/:id',
  roleMiddleware(['ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'ID inválido' });
      }

      await vehicleService.deleteVehicle(id);
      res.json({ message: 'Vehículo eliminado correctamente' });
    } catch (error) {
      next(error);
      }
  }
);

export default router;
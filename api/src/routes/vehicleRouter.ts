// Archivo: /flotillas/api/src/routes/vehicleRouter.ts
// NUEVO: Endpoints REST para vehículos
import { Router, Request, Response, NextFunction } from 'express';
import { vehicleSchema } from '../validators/vehicleValidator';
import * as vehicleService from '../services/vehicleService';
import { roleMiddleware, RoleGroups, Roles } from '../middlewares/roleMiddleware';

const router = Router();

/**
 * GET /api/vehicles
 * Lista paginada con filtros. Acceso: lectores de flota + EXECUTOR (acotado a
 * SUS vehículos). WORKSHOP (taller externo) queda excluido.
 */
router.get('/', roleMiddleware([...RoleGroups.VEHICLE_READERS, Roles.EXECUTOR]), async (req: Request, res: Response, next: NextFunction) => {
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

    // El EXECUTOR solo puede ver SUS vehículos: forzamos el scope en el servidor
    // e ignoramos cualquier executorId que envíe el cliente.
    if (req.user?.role === Roles.EXECUTOR) {
      query.executorId = req.user.userId;
    }

    const result = await vehicleService.getAllVehicles(query);
    res.json(result);
  } catch (error) {
    next(error);
    }
});

/**
 * GET /api/vehicles/:id
 * Detalle de un vehículo con relaciones. Acceso: lectores de flota
 * (excluye EXECUTOR/WORKSHOP, que no necesitan el detalle global).
 */
router.get('/:id', roleMiddleware(RoleGroups.VEHICLE_READERS), async (req: Request, res: Response, next: NextFunction) => {
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
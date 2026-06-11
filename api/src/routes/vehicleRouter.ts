// Endpoints REST para vehículos
import { Router, Request, Response } from 'express';
import { vehicleSchema, VehicleInput } from '../validators/vehicleValidator';
import * as vehicleService from '../services/vehicleService';
import { roleMiddleware, RoleGroups, Roles } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId, parsePagination } from '../lib/http';

const router = Router();

/**
 * GET /api/vehicles
 * Lista paginada con filtros. Acceso: lectores de flota + EXECUTOR (acotado a
 * SUS vehículos). WORKSHOP (taller externo) queda excluido.
 */
router.get(
  '/',
  roleMiddleware([...RoleGroups.VEHICLE_READERS, Roles.EXECUTOR]),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const query = {
      page,
      limit,
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
  }),
);

/**
 * GET /api/vehicles/:id
 * Detalle de un vehículo con relaciones. Acceso: lectores de flota
 * (excluye EXECUTOR/WORKSHOP, que no necesitan el detalle global).
 */
router.get(
  '/:id',
  roleMiddleware(RoleGroups.VEHICLE_READERS),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const vehicle = await vehicleService.getVehicleById(id);
    res.json(vehicle);
  }),
);

/**
 * POST /api/vehicles
 * Crear vehículo. Acceso: ADMIN, SUPERVISOR.
 */
router.post(
  '/',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  validateBody(vehicleSchema),
  ah(async (req: Request, res: Response) => {
    const vehicle = await vehicleService.createVehicle(req.body as VehicleInput);
    res.status(201).json(vehicle);
  }),
);

/**
 * PUT /api/vehicles/:id
 * Actualizar vehículo. Acceso: ADMIN, SUPERVISOR.
 */
router.put(
  '/:id',
  roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']),
  validateBody(vehicleSchema),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const vehicle = await vehicleService.updateVehicle(id, req.body as VehicleInput);
    res.json(vehicle);
  }),
);

/**
 * DELETE /api/vehicles/:id
 * Eliminar vehículo. Acceso: Solo ADMIN.
 */
router.delete(
  '/:id',
  roleMiddleware(['ADMIN']),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    await vehicleService.deleteVehicle(id);
    res.json({ message: 'Vehículo eliminado correctamente' });
  }),
);

export default router;

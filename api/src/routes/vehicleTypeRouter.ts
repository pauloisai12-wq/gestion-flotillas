// Endpoints REST para tipos de vehículo
import { Router, Request, Response } from 'express';
import { vehicleTypeSchema, VehicleTypeInput } from '../validators/vehicleTypeValidator';
import * as vehicleTypeService from '../services/vehicleTypeService';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId } from '../lib/http';

const router = Router();

/**
 * GET /api/vehicle-types
 * Lista todos los tipos de vehículo.
 * Acceso: ADMIN, SUPERVISOR, OPERATOR (todos pueden consultar)
 */
router.get(
  '/',
  ah(async (_req: Request, res: Response) => {
    const types = await vehicleTypeService.getAllVehicleTypes();
    res.json(types);
  }),
);

/**
 * GET /api/vehicle-types/:id
 * Obtiene un tipo de vehículo por ID.
 */
router.get(
  '/:id',
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const type = await vehicleTypeService.getVehicleTypeById(id);
    res.json(type);
  }),
);

/**
 * POST /api/vehicle-types
 * Crea un nuevo tipo de vehículo.
 * Acceso: Solo ADMIN
 */
router.post(
  '/',
  roleMiddleware(['ADMIN']),
  validateBody(vehicleTypeSchema),
  ah(async (req: Request, res: Response) => {
    const newType = await vehicleTypeService.createVehicleType(req.body as VehicleTypeInput);
    res.status(201).json(newType);
  }),
);

/**
 * PUT /api/vehicle-types/:id
 * Actualiza un tipo de vehículo.
 * Acceso: Solo ADMIN
 */
router.put(
  '/:id',
  roleMiddleware(['ADMIN']),
  validateBody(vehicleTypeSchema),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const updated = await vehicleTypeService.updateVehicleType(id, req.body as VehicleTypeInput);
    res.json(updated);
  }),
);

/**
 * DELETE /api/vehicle-types/:id
 * Elimina un tipo de vehículo (solo si no tiene vehículos asociados).
 * Acceso: Solo ADMIN
 */
router.delete(
  '/:id',
  roleMiddleware(['ADMIN']),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    await vehicleTypeService.deleteVehicleType(id);
    res.json({ message: 'Tipo de vehículo eliminado correctamente' });
  }),
);

export default router;

// Archivo: /flotillas/api/src/routes/vehicleTypeRouter.ts
// NUEVO: Endpoints REST para tipos de vehículo
import { Router, Request, Response, NextFunction } from 'express';
import { vehicleTypeSchema } from '../validators/vehicleTypeValidator';
import * as vehicleTypeService from '../services/vehicleTypeService';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

/**
 * GET /api/vehicle-types
 * Lista todos los tipos de vehículo.
 * Acceso: ADMIN, SUPERVISOR, OPERATOR (todos pueden consultar)
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await vehicleTypeService.getAllVehicleTypes();
    res.json(types);
  } catch (error) {
    next(error);
    }
});

/**
 * GET /api/vehicle-types/:id
 * Obtiene un tipo de vehículo por ID.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const type = await vehicleTypeService.getVehicleTypeById(id);
    res.json(type);
  } catch (error) {
    next(error);
    }
});

/**
 * POST /api/vehicle-types
 * Crea un nuevo tipo de vehículo.
 * Acceso: Solo ADMIN
 */
router.post('/', roleMiddleware(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validar datos de entrada con Zod
    const parsed = vehicleTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const newType = await vehicleTypeService.createVehicleType(parsed.data);
    res.status(201).json(newType);
  } catch (error) {
    next(error);
    }
});

/**
 * PUT /api/vehicle-types/:id
 * Actualiza un tipo de vehículo.
 * Acceso: Solo ADMIN
 */
router.put('/:id', roleMiddleware(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const parsed = vehicleTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const updated = await vehicleTypeService.updateVehicleType(id, parsed.data);
    res.json(updated);
  } catch (error) {
    next(error);
    }
});

/**
 * DELETE /api/vehicle-types/:id
 * Elimina un tipo de vehículo (solo si no tiene vehículos asociados).
 * Acceso: Solo ADMIN
 */
router.delete('/:id', roleMiddleware(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    await vehicleTypeService.deleteVehicleType(id);
    res.json({ message: 'Tipo de vehículo eliminado correctamente' });
  } catch (error) {
    next(error);
    }
});

export default router;
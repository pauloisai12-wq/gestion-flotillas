// /api/src/routes/fuelLoadRouter.ts
// Cargas de combustible v2 — NF + operador texto libre + status

import { Router, Request, Response } from 'express';
import { fuelLoadSchema } from '../validators/fuelLoadValidator';
import * as fuelLoadService from '../services/fuelLoadService';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { checkVehicleOperable } from '../middlewares/vehicleGuard';
import { ah } from '../lib/asyncHandler';
import { FuelLoadStatus } from '@prisma/client';

const router = Router();

router.get(
  '/',
  requireRole(RoleGroups.FUEL_MANAGERS),
  ah(async (req: Request, res: Response) => {
    const result = await fuelLoadService.getAllFuelLoads({
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      vehicleId: req.query.vehicleId ? parseInt(req.query.vehicleId as string) : undefined,
      operatorId: req.query.operatorId ? parseInt(req.query.operatorId as string) : undefined,
      stationId: req.query.stationId ? parseInt(req.query.stationId as string) : undefined,
      status: req.query.status as FuelLoadStatus | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
    });
    res.json(result);
  }),
);

router.get(
  '/vehicle/:vehicleId',
  requireRole(RoleGroups.VEHICLE_READERS),
  ah(async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId);
    if (isNaN(vehicleId)) return res.status(400).json({ error: 'ID inválido' });
    const loads = await fuelLoadService.getFuelLoadsByVehicle(vehicleId);
    const avg = await fuelLoadService.getVehicleMovingAverage(vehicleId);
    res.json({ loads, movingAverage: avg });
  }),
);

router.post(
  '/',
  requireRole(RoleGroups.FUEL_MANAGERS),
  checkVehicleOperable,
  ah(async (req: Request, res: Response) => {
    const parsed = fuelLoadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const load = await fuelLoadService.createFuelLoad(parsed.data);
    res.status(201).json(load);
  }),
);

export default router;

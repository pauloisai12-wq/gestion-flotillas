// Cargas de combustible v2 — NF + operador texto libre + status

import { Router, Request, Response } from 'express';
import {
  fuelLoadSchema,
  fuelLoadQuerySchema,
  FuelLoadInput,
  FuelLoadQueryInput,
} from '../validators/fuelLoadValidator';
import * as fuelLoadService from '../services/fuelLoadService';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { checkVehicleOperable } from '../middlewares/vehicleGuard';
import { ah } from '../lib/asyncHandler';
import { validateBody, validateQuery } from '../middlewares/validate';
import { parseId, parsePagination } from '../lib/http';

const router = Router();

router.get(
  '/',
  requireRole(RoleGroups.FUEL_MANAGERS),
  validateQuery(fuelLoadQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const { vehicleId, operatorId, stationId, status, dateFrom, dateTo } =
      req.query as unknown as FuelLoadQueryInput;
    const result = await fuelLoadService.getAllFuelLoads({
      page,
      limit,
      vehicleId,
      operatorId,
      stationId,
      status,
      dateFrom,
      dateTo,
    });
    res.json(result);
  }),
);

router.get(
  '/vehicle/:vehicleId',
  requireRole(RoleGroups.VEHICLE_READERS),
  ah(async (req, res) => {
    const vehicleId = parseId(req, 'vehicleId');
    const [loads, avg] = await Promise.all([
      fuelLoadService.getFuelLoadsByVehicle(vehicleId),
      fuelLoadService.getVehicleMovingAverage(vehicleId),
    ]);
    res.json({ loads, movingAverage: avg });
  }),
);

router.post(
  '/',
  requireRole(RoleGroups.FUEL_MANAGERS),
  checkVehicleOperable,
  validateBody(fuelLoadSchema),
  ah(async (req: Request, res: Response) => {
    const load = await fuelLoadService.createFuelLoad(req.body as FuelLoadInput);
    res.status(201).json(load);
  }),
);

export default router;

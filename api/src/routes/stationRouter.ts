// Rutas de gasolineras — admin + sup_fuel

import { Router, Request, Response, NextFunction } from 'express';
import { stationSchema, stationUpdateSchema, StationInput } from '../validators/stationValidator';
import * as stationService from '../services/stationService';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { isPrismaKnownError, Conflict } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId } from '../lib/http';

const router = Router();

router.get(
  '/',
  requireRole(RoleGroups.ANY_AUTH),
  ah(async (_req: Request, res: Response) => {
    const stations = await stationService.getAllStations();
    res.json(stations);
  }),
);

router.get(
  '/:id',
  requireRole(RoleGroups.ANY_AUTH),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const station = await stationService.getStationById(id);
    res.json(station);
  }),
);

router.post(
  '/',
  requireRole(RoleGroups.FUEL_MANAGERS),
  validateBody(stationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const station = await stationService.createStation(req.body as StationInput);
      res.status(201).json(station);
    } catch (error) {
      if (isPrismaKnownError(error, 'P2002')) return next(Conflict('RFC ya registrado'));
      next(error);
    }
  },
);

router.put(
  '/:id',
  requireRole(RoleGroups.FUEL_MANAGERS),
  validateBody(stationUpdateSchema),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const station = await stationService.updateStation(id, req.body as Partial<StationInput>);
    res.json(station);
  }),
);

router.delete(
  '/:id',
  requireRole(RoleGroups.FUEL_MANAGERS),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    await stationService.deleteStation(id);
    res.json({ message: 'Gasolinera eliminada/desactivada' });
  }),
);

export default router;

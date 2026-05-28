// /api/src/routes/stationRouter.ts
// Rutas de gasolineras — admin + sup_fuel

import { Router, Request, Response, NextFunction } from 'express';
import { stationSchema, stationUpdateSchema } from '../validators/stationValidator';
import * as stationService from '../services/stationService';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { isPrismaKnownError, Conflict } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';

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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const station = await stationService.getStationById(id);
    res.json(station);
  }),
);

router.post(
  '/',
  requireRole(RoleGroups.FUEL_MANAGERS),
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = stationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    try {
      const station = await stationService.createStation(parsed.data);
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
  async (req: Request, res: Response, next: NextFunction) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const parsed = stationUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    try {
      const station = await stationService.updateStation(id, parsed.data);
      res.json(station);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/:id',
  requireRole(RoleGroups.FUEL_MANAGERS),
  async (req: Request, res: Response, next: NextFunction) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
      await stationService.deleteStation(id);
      res.json({ message: 'Gasolinera eliminada/desactivada' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

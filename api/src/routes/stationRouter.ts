// /api/src/routes/stationRouter.ts
// Rutas de gasolineras — admin + sup_fuel

import { Router, Request, Response } from 'express';
import { stationSchema, stationUpdateSchema } from '../validators/stationValidator';
import * as stationService from '../services/stationService';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';

const router = Router();

router.get('/', requireRole(RoleGroups.ANY_AUTH), async (_req: Request, res: Response) => {
  try {
    const stations = await stationService.getAllStations();
    res.json(stations);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:id', requireRole(RoleGroups.ANY_AUTH), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const station = await stationService.getStationById(id);
    res.json(station);
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

router.post('/', requireRole(RoleGroups.FUEL_MANAGERS), async (req: Request, res: Response) => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((error as any).code === 'P2002') {
      return res.status(409).json({ error: 'RFC ya registrado' });
    }
    res.status(400).json({ error: (error as Error).message });
  }
});

router.put('/:id', requireRole(RoleGroups.FUEL_MANAGERS), async (req: Request, res: Response) => {
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
    res.status(400).json({ error: (error as Error).message });
  }
});

router.delete('/:id', requireRole(RoleGroups.FUEL_MANAGERS), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await stationService.deleteStation(id);
    res.json({ message: 'Gasolinera eliminada/desactivada' });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;

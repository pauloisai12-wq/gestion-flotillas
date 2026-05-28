// /api/src/routes/sectorRouter.ts
// Catálogo de sectores — admin-only para CRUD, todos pueden leer

import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { isPrismaKnownError, Conflict } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { sectorSchema, sectorUpdateSchema } from '../validators/sectorValidator';

const router = Router();

router.get(
  '/',
  requireRole(RoleGroups.ANY_AUTH),
  ah(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const sectors = await prisma.sector.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
      take: 500,
    });
    res.json({ data: sectors });
  }),
);

router.post(
  '/',
  requireRole(RoleGroups.ADMIN_ONLY),
  ah(async (req, res) => {
    const parsed = sectorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
      return;
    }
    try {
      const sector = await prisma.sector.create({ data: parsed.data });
      res.status(201).json({ data: sector });
    } catch (e) {
      if (isPrismaKnownError(e, 'P2002')) throw Conflict('Código de sector ya existe');
      throw e;
    }
  }),
);

router.patch(
  '/:id',
  requireRole(RoleGroups.ADMIN_ONLY),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = sectorUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
      return;
    }
    const sector = await prisma.sector.update({ where: { id }, data: parsed.data });
    res.json({ data: sector });
  }),
);

router.delete(
  '/:id',
  requireRole(RoleGroups.ADMIN_ONLY),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.sector.update({ where: { id }, data: { isActive: false } });
    res.status(204).end();
  }),
);

export default router;

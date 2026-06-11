// Catálogo de sectores — admin-only para CRUD, todos pueden leer

import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { isPrismaKnownError, Conflict } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId } from '../lib/http';
import { sectorSchema, sectorUpdateSchema, SectorInput } from '../validators/sectorValidator';

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
  validateBody(sectorSchema),
  ah(async (req, res) => {
    try {
      const sector = await prisma.sector.create({ data: req.body as SectorInput });
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
  validateBody(sectorUpdateSchema),
  ah(async (req, res) => {
    const id = parseId(req);
    const sector = await prisma.sector.update({
      where: { id },
      data: req.body as Partial<SectorInput>,
    });
    res.json({ data: sector });
  }),
);

router.delete(
  '/:id',
  requireRole(RoleGroups.ADMIN_ONLY),
  ah(async (req, res) => {
    const id = parseId(req);
    await prisma.sector.update({ where: { id }, data: { isActive: false } });
    res.status(204).end();
  }),
);

export default router;

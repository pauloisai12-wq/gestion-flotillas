// CRUD de talleres certificados (gemelo de stations)

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { isPrismaKnownError, Conflict } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId, ensureFound } from '../lib/http';
import { workshopSchema, workshopUpdateSchema, WorkshopInput } from '../validators/workshopValidator';

const router = Router();

/** GET — todos los talleres activos visibles por ADMIN y SUP_MAINT */
router.get(
  '/',
  requireRole(RoleGroups.MAINT_MANAGERS),
  ah(async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === 'true';
    const workshops = await prisma.workshop.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { legalName: 'asc' },
      take: 500,
    });
    res.json({ data: workshops });
  }),
);

/** GET /:id */
router.get(
  '/:id',
  requireRole(RoleGroups.MAINT_MANAGERS),
  ah(async (req, res) => {
    const id = parseId(req);
    const workshop = ensureFound(await prisma.workshop.findUnique({ where: { id } }), 'Taller');
    res.json({ data: workshop });
  }),
);

/** POST — admin crea taller */
router.post(
  '/',
  requireRole(RoleGroups.MAINT_MANAGERS),
  validateBody(workshopSchema),
  ah(async (req: Request, res: Response) => {
    try {
      const workshop = await prisma.workshop.create({ data: req.body as WorkshopInput });
      res.status(201).json({ data: workshop });
    } catch (e) {
      if (isPrismaKnownError(e, 'P2002')) throw Conflict('RFC ya registrado');
      throw e;
    }
  }),
);

/** PATCH /:id */
router.patch(
  '/:id',
  requireRole(RoleGroups.MAINT_MANAGERS),
  validateBody(workshopUpdateSchema),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const workshop = await prisma.workshop.update({
      where: { id },
      data: req.body as Partial<WorkshopInput>,
    });
    res.json({ data: workshop });
  }),
);

/** DELETE /:id — soft delete (marca inactivo) */
router.delete(
  '/:id',
  requireRole(RoleGroups.MAINT_MANAGERS),
  ah(async (req, res) => {
    const id = parseId(req);
    await prisma.workshop.update({ where: { id }, data: { isActive: false } });
    res.status(204).end();
  }),
);

export default router;

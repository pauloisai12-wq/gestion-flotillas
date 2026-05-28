// /api/src/routes/workshopRouter.ts
// CRUD de talleres certificados (gemelo de stations)

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { isPrismaKnownError, Conflict, NotFound } from '../middlewares/errorHandler';
import { ah } from '../lib/asyncHandler';
import { workshopSchema, workshopUpdateSchema } from '../validators/workshopValidator';

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
    const id = Number(req.params.id);
    const workshop = await prisma.workshop.findUnique({ where: { id } });
    if (!workshop) throw NotFound('Taller');
    res.json({ data: workshop });
  }),
);

/** POST — admin crea taller */
router.post(
  '/',
  requireRole(RoleGroups.MAINT_MANAGERS),
  ah(async (req: Request, res: Response) => {
    const parsed = workshopSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
      return;
    }
    try {
      const workshop = await prisma.workshop.create({ data: parsed.data });
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
  ah(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const parsed = workshopUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
      return;
    }
    const workshop = await prisma.workshop.update({ where: { id }, data: parsed.data });
    res.json({ data: workshop });
  }),
);

/** DELETE /:id — soft delete (marca inactivo) */
router.delete(
  '/:id',
  requireRole(RoleGroups.MAINT_MANAGERS),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.workshop.update({ where: { id }, data: { isActive: false } });
    res.status(204).end();
  }),
);

export default router;

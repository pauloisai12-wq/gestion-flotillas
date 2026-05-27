// /api/src/routes/workshopRouter.ts
// CRUD de talleres certificados (gemelo de stations)

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { workshopSchema, workshopUpdateSchema } from '../validators/workshopValidator';

const prisma = new PrismaClient();
const router = Router();

/** GET — todos los talleres activos visibles por ADMIN y SUP_MAINT */
router.get('/', requireRole(RoleGroups.MAINT_MANAGERS), async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === 'true';
  const workshops = await prisma.workshop.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { legalName: 'asc' },
  });
  res.json({ data: workshops });
});

/** GET /:id */
router.get('/:id', requireRole(RoleGroups.MAINT_MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  const workshop = await prisma.workshop.findUnique({ where: { id } });
  if (!workshop) return res.status(404).json({ error: 'Taller no encontrado' });
  res.json({ data: workshop });
});

/** POST — admin crea taller */
router.post('/', requireRole(RoleGroups.MAINT_MANAGERS), async (req: Request, res: Response) => {
  const parsed = workshopSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });

  try {
    const workshop = await prisma.workshop.create({ data: parsed.data });
    res.status(201).json({ data: workshop });
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((e as any).code === 'P2002') {
      return res.status(409).json({ error: 'RFC ya registrado' });
    }
    throw e;
  }
});

/** PATCH /:id */
router.patch('/:id', requireRole(RoleGroups.MAINT_MANAGERS), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = workshopUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
  const workshop = await prisma.workshop.update({ where: { id }, data: parsed.data });
  res.json({ data: workshop });
});

/** DELETE /:id — soft delete (marca inactivo) */
router.delete('/:id', requireRole(RoleGroups.MAINT_MANAGERS), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.workshop.update({ where: { id }, data: { isActive: false } });
  res.status(204).end();
});

export default router;

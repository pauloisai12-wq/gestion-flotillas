// /api/src/routes/sectorRouter.ts
// Catálogo de sectores — admin-only para CRUD, todos pueden leer

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { sectorSchema, sectorUpdateSchema } from '../validators/sectorValidator';

const prisma = new PrismaClient();
const router = Router();

router.get('/', requireRole(RoleGroups.ANY_AUTH), async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const sectors = await prisma.sector.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { code: 'asc' },
  });
  res.json({ data: sectors });
});

router.post('/', requireRole(RoleGroups.ADMIN_ONLY), async (req: Request, res: Response) => {
  const parsed = sectorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
  try {
    const sector = await prisma.sector.create({ data: parsed.data });
    res.status(201).json({ data: sector });
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((e as any).code === 'P2002') return res.status(409).json({ error: 'Código de sector ya existe' });
    throw e;
  }
});

router.patch('/:id', requireRole(RoleGroups.ADMIN_ONLY), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = sectorUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
  const sector = await prisma.sector.update({ where: { id }, data: parsed.data });
  res.json({ data: sector });
});

router.delete('/:id', requireRole(RoleGroups.ADMIN_ONLY), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.sector.update({ where: { id }, data: { isActive: false } });
  res.status(204).end();
});

export default router;

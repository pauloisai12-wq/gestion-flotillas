// /api/src/routes/vehicleNoteRouter.ts
// Bitácora de notas de un vehículo — append-only log con edición auditada

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireRole, RoleGroups, Roles } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { vehicleNoteCreateSchema, vehicleNoteUpdateSchema } from '../validators/vehicleNoteValidator';

const prisma = new PrismaClient();
const router = Router({ mergeParams: true });

/** GET /api/vehicles/:vehicleId/notes — histórico completo */
router.get(
  '/vehicles/:vehicleId/notes',
  requireRole(RoleGroups.VEHICLE_READERS),
  ah(async (req: Request, res: Response) => {
    const vehicleId = Number(req.params.vehicleId);
    if (!Number.isInteger(vehicleId)) return res.status(400).json({ error: 'ID inválido' });
    const notes = await prisma.vehicleNote.findMany({
      where: { vehicleId, deletedAt: null },
      include: {
        author: { select: { id: true, fullName: true, email: true } },
        editor: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: notes });
  }),
);

/** POST /api/vehicles/:vehicleId/notes — agregar nota nueva */
router.post(
  '/vehicles/:vehicleId/notes',
  requireRole(RoleGroups.NOTES_WRITERS),
  ah(async (req: Request, res: Response) => {
    const vehicleId = Number(req.params.vehicleId);
    if (!Number.isInteger(vehicleId)) return res.status(400).json({ error: 'ID inválido' });
    const parsed = vehicleNoteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
    }
    const userId = req.user!.userId;

    const vehicleExists = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
    if (!vehicleExists) return res.status(404).json({ error: 'Vehículo no encontrado' });

    const note = await prisma.vehicleNote.create({
      data: { vehicleId, content: parsed.data.content, createdBy: userId },
      include: { author: { select: { id: true, fullName: true } } },
    });
    res.status(201).json({ data: note });
  }),
);

/** PATCH /api/notes/:noteId — editar (autor o admin) */
router.patch(
  '/notes/:noteId',
  requireRole(RoleGroups.NOTES_WRITERS),
  ah(async (req: Request, res: Response) => {
    const noteId = Number(req.params.noteId);
    if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'ID inválido' });
    const parsed = vehicleNoteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
    }
    const user = req.user!;

    const note = await prisma.vehicleNote.findUnique({ where: { id: noteId } });
    if (!note || note.deletedAt) return res.status(404).json({ error: 'Nota no encontrada' });

    // Solo autor o admin puede editar
    if (note.createdBy !== user.userId && user.role !== Roles.ADMIN) {
      return res.status(403).json({ error: 'Solo el autor o un admin puede editar esta nota' });
    }

    const updated = await prisma.vehicleNote.update({
      where: { id: noteId },
      data: { content: parsed.data.content, updatedBy: user.userId },
      include: {
        author: { select: { id: true, fullName: true } },
        editor: { select: { id: true, fullName: true } },
      },
    });
    res.json({ data: updated });
  }),
);

/** DELETE /api/notes/:noteId — soft delete (admin o autor) */
router.delete(
  '/notes/:noteId',
  requireRole(RoleGroups.NOTES_WRITERS),
  ah(async (req: Request, res: Response) => {
    const noteId = Number(req.params.noteId);
    if (!Number.isInteger(noteId)) return res.status(400).json({ error: 'ID inválido' });
    const user = req.user!;

    const note = await prisma.vehicleNote.findUnique({ where: { id: noteId } });
    if (!note || note.deletedAt) return res.status(404).json({ error: 'Nota no encontrada' });

    if (note.createdBy !== user.userId && user.role !== Roles.ADMIN) {
      return res.status(403).json({ error: 'Solo el autor o un admin puede eliminar esta nota' });
    }

    await prisma.vehicleNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date(), updatedBy: user.userId },
    });
    res.status(204).end();
  }),
);

export default router;

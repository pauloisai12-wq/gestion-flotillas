// Bitácora de notas de un vehículo — append-only log con edición auditada

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups, Roles } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId, ensureFound } from '../lib/http';
import {
  vehicleNoteCreateSchema,
  vehicleNoteUpdateSchema,
  VehicleNoteInput,
} from '../validators/vehicleNoteValidator';

const router = Router({ mergeParams: true });

/** GET /api/vehicles/:vehicleId/notes — histórico completo */
router.get(
  '/vehicles/:vehicleId/notes',
  requireRole(RoleGroups.VEHICLE_READERS),
  ah(async (req: Request, res: Response) => {
    const vehicleId = parseId(req, 'vehicleId');
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
  validateBody(vehicleNoteCreateSchema),
  ah(async (req: Request, res: Response) => {
    const vehicleId = parseId(req, 'vehicleId');
    const { content } = req.body as VehicleNoteInput;
    const userId = req.user!.userId;

    ensureFound(
      await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } }),
      'Vehículo',
    );

    const note = await prisma.vehicleNote.create({
      data: { vehicleId, content, createdBy: userId },
      include: { author: { select: { id: true, fullName: true } } },
    });
    res.status(201).json({ data: note });
  }),
);

/** PATCH /api/notes/:noteId — editar (autor o admin) */
router.patch(
  '/notes/:noteId',
  requireRole(RoleGroups.NOTES_WRITERS),
  validateBody(vehicleNoteUpdateSchema),
  ah(async (req: Request, res: Response) => {
    const noteId = parseId(req, 'noteId');
    const { content } = req.body as VehicleNoteInput;
    const user = req.user!;

    const note = await prisma.vehicleNote.findUnique({ where: { id: noteId } });
    if (!note || note.deletedAt) return res.status(404).json({ error: 'Nota no encontrada' });

    // Solo autor o admin puede editar
    if (note.createdBy !== user.userId && user.role !== Roles.ADMIN) {
      return res.status(403).json({ error: 'Solo el autor o un admin puede editar esta nota' });
    }

    const updated = await prisma.vehicleNote.update({
      where: { id: noteId },
      data: { content, updatedBy: user.userId },
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
    const noteId = parseId(req, 'noteId');
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

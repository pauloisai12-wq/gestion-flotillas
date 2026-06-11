// Endpoints para notificaciones internas.
// Cada usuario solo ve sus propias notificaciones.

import { Router, Request, Response, NextFunction } from 'express';
import * as notificationService from '../services/notificationService';
import { ah } from '../lib/asyncHandler';
import { parseId, parsePagination } from '../lib/http';

const router = Router();

// GET /api/notifications — Lista de notificaciones del usuario autenticado
router.get('/', ah(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { page, limit } = parsePagination(req);

  const result = await notificationService.getByUser(userId, page, limit);
  res.json(result);
}));

// GET /api/notifications/count — Conteo de no leídas (para el badge de la campana)
router.get('/count', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const count = await notificationService.getUnreadCount(userId);
    res.json({ data: { unreadCount: count } });
  } catch (error) {
    next(error);
    }
});

// PUT /api/notifications/:id/read — Marcar una como leída
router.put('/:id/read', ah(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = parseId(req);

  await notificationService.markAsRead(id, userId);
  res.json({ message: 'Notificación marcada como leída' });
}));

// PUT /api/notifications/read-all — Marcar todas como leídas
router.put('/read-all', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    await notificationService.markAllAsRead(userId);
    res.json({ message: 'Todas las notificaciones marcadas como leídas' });
  } catch (error) {
    next(error);
    }
});

export default router;
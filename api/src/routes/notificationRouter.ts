// api/src/routes/notificationRouter.ts
// Endpoints para notificaciones internas.
// Cada usuario solo ve sus propias notificaciones.

import { Router, Request, Response, NextFunction } from 'express';
import * as notificationService from '../services/notificationService';

const router = Router();

// GET /api/notifications — Lista de notificaciones del usuario autenticado
router.get('/', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    const result = await notificationService.getByUser(userId, page, limit);
    res.json(result);
  } catch (error) {
    next(error);
    }
});

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
router.put('/:id/read', async function(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    await notificationService.markAsRead(id, userId);
    res.json({ message: 'Notificación marcada como leída' });
  } catch (error) {
    next(error);
    }
});

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
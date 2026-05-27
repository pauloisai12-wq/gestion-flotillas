// /api/src/routes/auditLogRouter.ts — admin-only audit log

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod/v4';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';

const router = Router();

const querySchema = z.object({
  resource: z.string().optional(),
  action: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
  resourceId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get('/', requireRole(RoleGroups.ADMIN_ONLY), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = querySchema.parse(req.query);
    const where = {
      ...(q.resource ? { resource: q.resource } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      data: items,
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    });
  } catch (e) {
    next(e);
  }
});

export default router;

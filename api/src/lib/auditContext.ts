// AsyncLocalStorage para propagar contexto de request (userId, IP) hasta los middlewares de Prisma

import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

export interface AuditContext {
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

/** Middleware que crea el contexto a partir del request */
export function auditContextMiddleware(req: Request, res: Response, next: NextFunction) {
  storage.run(
    {
      userId: req.user?.userId,
      ipAddress: (req.ip || req.socket.remoteAddress || '').toString(),
      userAgent: req.headers['user-agent']?.toString(),
      requestId: res.getHeader('x-request-id') as string | undefined,
    },
    next,
  );
}

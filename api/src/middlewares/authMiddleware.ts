// Auth middleware — verifica JWT + crea contexto de auditoría

import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';
import { runWithAuditContext } from '../lib/auditContext';
import { Unauthorized } from './errorHandler';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next(Unauthorized('Token requerido'));

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(Unauthorized('Formato inválido. Use: Bearer <token>'));
  }

  try {
    const payload = verifyToken(parts[1]);
    req.user = payload;

    // Crear contexto de auditoría con userId/ip/requestId
    runWithAuditContext(
      {
        userId: payload.userId,
        ipAddress: (req.ip || req.socket.remoteAddress || '').toString(),
        userAgent: req.headers['user-agent']?.toString(),
        requestId: res.getHeader('x-request-id') as string | undefined,
      },
      () => next(),
    );
  } catch {
    return next(Unauthorized('Token inválido o expirado'));
  }
}

// Auth middleware — verifica JWT + crea contexto de auditoría

import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';
import { runWithAuditContext } from '../lib/auditContext';
import { Unauthorized } from './errorHandler';

/** Extrae el token de la cookie 'token=...' (sin depender de cookie-parser). */
function tokenFromCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'token' && rest.length > 0) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 1) Bearer header (compat) — 2) cookie httpOnly (preferido).
  let token: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return next(Unauthorized('Formato inválido. Use: Bearer <token>'));
    }
    token = parts[1];
  } else {
    token = tokenFromCookie(req);
  }

  if (!token) return next(Unauthorized('Token requerido'));

  try {
    const payload = verifyToken(token);
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

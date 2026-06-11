// Auth middleware — verifica JWT + crea contexto de auditoría

import { Request, Response, NextFunction } from 'express';
import { verifyToken, isTokenBlacklisted, type JwtPayload } from '../services/authService';
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

/**
 * Extrae el token de la petición: 1) Bearer header (compat) — 2) cookie
 * httpOnly (preferido). Lanza Unauthorized si el header tiene formato inválido.
 */
export function tokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw Unauthorized('Formato inválido. Use: Bearer <token>');
    }
    return parts[1];
  }
  return tokenFromCookie(req);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = tokenFromRequest(req);
    if (!token) return next(Unauthorized('Token requerido'));

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch {
      return next(Unauthorized('Token inválido o expirado'));
    }

    // Token invalidado por logout (blacklist en Redis; fail-open si Redis cae).
    if (await isTokenBlacklisted(token)) {
      return next(Unauthorized('Sesión cerrada'));
    }

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
  } catch (err) {
    // Middleware async: cualquier error debe seguir llegando al errorHandler.
    next(err);
  }
}

// Rate limiter con Redis — sobrevive restarts y escala horizontalmente
// Atomic via INCR + EXPIRE

import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { TooManyRequests, AppError } from './errorHandler';

interface RateLimitOptions {
  /** Máximo de peticiones permitidas en la ventana */
  max: number;
  /** Ventana en segundos */
  windowSec: number;
  /** Construye la clave Redis. Default: IP del request. */
  keyBuilder?: (req: Request) => string;
  /** Mensaje custom al exceder */
  message?: string;
  /**
   * Comportamiento ante fallo de Redis:
   *   false (default) → fail-open: se permite el request (prioriza disponibilidad).
   *   true            → fail-closed: se rechaza con 503 (p.ej. /login, para no
   *                     desactivar la protección anti brute-force si Redis cae).
   */
  failClosed?: boolean;
}

// INCR + EXPIRE atómicos. El EXPIRE se (re)aplica si la clave no tiene TTL,
// de modo que una clave nunca queda sin caducidad (evita lockouts permanentes
// por una carrera entre INCR y EXPIRE en comandos separados).
const RATE_LIMIT_LUA = `
local c = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`;

export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const baseKey = opts.keyBuilder ? opts.keyBuilder(req) : `ip:${getClientIp(req)}`;
      const key = `rl:${baseKey}`;
      const redis = getRedis();

      const count = Number(await redis.eval(RATE_LIMIT_LUA, 1, key, String(opts.windowSec)));

      // Headers informativos
      res.setHeader('X-RateLimit-Limit', opts.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, opts.max - count));
      const ttl = await redis.ttl(key);
      if (ttl > 0) res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + ttl);

      if (count > opts.max) {
        res.setHeader('Retry-After', ttl);
        logger.warn({ key, count, max: opts.max }, 'Rate limit excedido');
        return next(TooManyRequests(opts.message ?? `Demasiados intentos. Espera ${ttl}s.`));
      }
      next();
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Rate limiter falló');
      if (opts.failClosed) {
        // Fail-closed: sin Redis no podemos garantizar el límite → rechazamos.
        return next(new AppError(503, 'Servicio temporalmente no disponible. Intenta de nuevo.', 'SERVICE_UNAVAILABLE'));
      }
      // Fail-open: priorizamos disponibilidad y permitimos el request.
      next();
    }
  };
}

/**
 * Obtiene la IP del cliente. req.ip respeta X-Forwarded-For SOLO si TRUST_PROXY
 * está configurado (ver env.ts + app.set('trust proxy') en index.ts). Detrás de
 * Caddy/Next debe estar configurado, o todas las peticiones comparten la IP
 * interna del proxy y el rate-limit por IP deja de aislar a cada cliente.
 */
export function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').toString();
}

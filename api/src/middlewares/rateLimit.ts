// Rate limiter con Redis — sobrevive restarts y escala horizontalmente
// Atomic via INCR + EXPIRE

import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { TooManyRequests } from './errorHandler';

interface RateLimitOptions {
  /** Máximo de peticiones permitidas en la ventana */
  max: number;
  /** Ventana en segundos */
  windowSec: number;
  /** Construye la clave Redis. Default: IP del request. */
  keyBuilder?: (req: Request) => string;
  /** Mensaje custom al exceder */
  message?: string;
}

export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const baseKey = opts.keyBuilder ? opts.keyBuilder(req) : `ip:${getClientIp(req)}`;
      const key = `rl:${baseKey}`;
      const redis = getRedis();

      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSec);

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
      // Si Redis falla, NO bloqueamos el request (fail-open)
      logger.error({ err: (e as Error).message }, 'Rate limiter falló, permitiendo request');
      next();
    }
  };
}

/** Obtiene la IP real del cliente (respeta X-Forwarded-For si trust proxy está activado) */
export function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || 'unknown').toString();
}

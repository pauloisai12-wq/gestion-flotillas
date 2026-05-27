// Cliente Redis singleton — reutilizable para rate-limit, cache, etc.

import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ attempt: times, delay }, 'Redis reintenta conexión');
      return delay;
    },
  });

  client.on('connect', () => logger.info('Redis conectado'));
  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  client.on('close', () => logger.warn('Redis desconectado'));

  return client;
}

// api/src/config/queue.ts
// Configuración central de BullMQ — conexión a Redis
// Todos los jobs y workers del sistema usan esta configuración

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { env } from './env';
import { logger } from '../lib/logger';

// Parseamos REDIS_URL (única fuente de verdad — validada en env.ts) para BullMQ.
// Soporta: redis://[:password@]host[:port] (puerto default 6379).
// IMPORTANTE: se extraen también username/password — si Redis corre con
// --requirepass y no se propagaran aquí, BullMQ no podría autenticarse.
function parseRedisUrl(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
} {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    logger.warn({ url }, 'REDIS_URL inválida, usando defaults');
    return { host: 'localhost', port: 6379 };
  }
}

export const redisConnection: ConnectionOptions = parseRedisUrl(env.REDIS_URL);

/**
 * Crea una cola de BullMQ.
 * Una "cola" es como una lista de tareas pendientes.
 * Ejemplo: la cola "compliance" tendrá el job de revisar documentos vencidos.
 */
export function createQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection });
}

/**
 * Crea un worker de BullMQ.
 * Un "worker" es el que EJECUTA las tareas de una cola.
 * Recibe el nombre de la cola y una función que dice qué hacer con cada tarea.
 */
export function createWorker(
  name: string,
  processor: (job: Job) => Promise<void>
): Worker {
  const worker = new Worker(name, processor, { connection: redisConnection });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, queue: name }, `Job completado en cola "${name}"`);
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: name, err: err.message }, `Job falló en cola "${name}"`);
  });

  return worker;
}

// Healthcheck con verificación de dependencias

import { Request, Response } from 'express';
import prisma from './prisma';
import { getRedis } from './redis';
import { logger } from './logger';

interface CheckResult {
  status: 'ok' | 'down';
  latencyMs?: number;
  error?: string;
}

async function checkPostgres(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    return { status: 'down', error: (e as Error).message };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const redis = getRedis();
    const reply = await redis.ping();
    if (reply !== 'PONG') return { status: 'down', error: `Unexpected: ${reply}` };
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    return { status: 'down', error: (e as Error).message };
  }
}

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  const allOk = postgres.status === 'ok' && redis.status === 'ok';

  const body = {
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks: {
      api: { status: 'ok' as const },
      postgres,
      redis,
    },
  };

  if (!allOk) logger.warn(body, 'Health degraded');
  res.status(allOk ? 200 : 503).json(body);
}

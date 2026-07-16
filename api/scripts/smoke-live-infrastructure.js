// Smoke de CI contra PostgreSQL/Redis reales. Se ejecuta con la API levantada
// para comprobar que las migraciones existen y que initializeJobs publico los
// schedulers criticos del Sprint 3.
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');

const prisma = new PrismaClient();

function redisConnection(rawUrl) {
  const parsed = new URL(rawUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

function schedulerKeys(rows) {
  return new Set(rows.map((row) => row.key || row.id).filter(Boolean));
}

async function waitForSchedulers(queue, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let observed = new Set();
  while (Date.now() < deadline) {
    observed = schedulerKeys(await queue.getJobSchedulers(0, 100, true));
    if (expected.every((key) => observed.has(key))) return [...observed];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Schedulers ausentes en ${queue.name}: ${expected.filter((key) => !observed.has(key)).join(', ')}`,
  );
}

async function main() {
  const connection = redisConnection(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const reportQueue = new Queue('report-dispatch', { connection });
  const mediaQueue = new Queue('media-processing', { connection });
  try {
    const database = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS database, (SELECT COUNT(*)::int FROM data_jobs) AS data_jobs',
    );
    const reportSchedulers = await waitForSchedulers(reportQueue, [
      'monthly-report-scheduler',
      'report-outbox-scheduler',
    ]);
    const mediaSchedulers = await waitForSchedulers(mediaQueue, [
      'thumbnail-backfill-scheduler-v1',
    ]);
    const queueCounts = await mediaQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
    );
    console.log(JSON.stringify({
      status: 'ok',
      database: database[0],
      reportSchedulers,
      mediaSchedulers,
      queueCounts,
    }));
  } finally {
    await Promise.allSettled([reportQueue.close(), mediaQueue.close()]);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

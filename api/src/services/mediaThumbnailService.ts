import crypto from 'crypto';
import path from 'path';
import { constants as fsConstants, promises as fs } from 'fs';
import sharp from 'sharp';
import type { Job, Worker } from 'bullmq';
import { createQueue, createWorker } from '../config/queue';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import prisma from '../lib/prisma';
import { UPLOAD_DIRS } from '../lib/uploadStorage';

const QUEUE_NAME = 'media-processing';
const THUMBNAIL_SIZE = 512;
const THUMBNAIL_QUALITY = 78;
const MAX_THUMBNAIL_INPUT_PIXELS = 40_000_000;
const THUMBNAIL_BACKFILL_INTERVAL_MS = 15 * 60 * 1000;
const mediaQueue = createQueue(QUEUE_NAME);

type QaThumbnailJob = {
  kind: 'QA';
  programa: 'BUFFALO' | 'LX';
  sha256: string;
};

type TicketThumbnailJob = {
  kind: 'TICKET';
  fileName: string;
};

type BackfillJob = { kind: 'BACKFILL' };
type MediaJob = QaThumbnailJob | TicketThumbnailJob | BackfillJob;

const SHA256_RE = /^[a-f0-9]{64}$/;
const TICKET_FILE_RE = /^[a-f0-9-]{36}\.(?:jpe?g|png)$/i;

function qaSubdir(programa: 'BUFFALO' | 'LX'): 'buffalo' | 'lx' {
  return programa === 'BUFFALO' ? 'buffalo' : 'lx';
}

export function qaThumbnailPath(programa: 'BUFFALO' | 'LX', sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new Error('Hash QA inválido');
  return path.resolve(env.QA_EXTERNA_DIR, 'thumbnails', qaSubdir(programa), `${sha256}.webp`);
}

function qaSourcePath(programa: 'BUFFALO' | 'LX', sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new Error('Hash QA inválido');
  return path.resolve(env.QA_EXTERNA_DIR, qaSubdir(programa), `${sha256}.jpg`);
}

export function ticketThumbnailPath(fileName: string): string {
  const safeName = path.basename(fileName);
  if (!TICKET_FILE_RE.test(safeName)) throw new Error('Nombre de evidencia inválido');
  return path.resolve(
    UPLOAD_DIRS.maintenanceTicketThumbnails,
    `${path.parse(safeName).name}.webp`,
  );
}

function ticketSourcePath(fileName: string): string {
  const safeName = path.basename(fileName);
  if (!TICKET_FILE_RE.test(safeName)) throw new Error('Nombre de evidencia inválido');
  return path.resolve(UPLOAD_DIRS.maintenanceTicketPhotos, safeName);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function renderThumbnail(sourcePath: string, targetPath: string): Promise<void> {
  if (await exists(targetPath)) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp.webp`,
  );
  try {
    await sharp(sourcePath, { failOn: 'error', limitInputPixels: MAX_THUMBNAIL_INPUT_PIXELS })
      .rotate()
      .resize({
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMBNAIL_QUALITY, effort: 4 })
      .toFile(tempPath);
    try {
      await fs.copyFile(tempPath, targetPath, fsConstants.COPYFILE_EXCL);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  } finally {
    await fs.unlink(tempPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') logger.warn({ err, tempPath }, 'No se pudo limpiar thumbnail temporal');
    });
  }
}

async function renderQaThumbnail(job: QaThumbnailJob): Promise<void> {
  await renderThumbnail(
    qaSourcePath(job.programa, job.sha256),
    qaThumbnailPath(job.programa, job.sha256),
  );
}

async function renderTicketThumbnail(job: TicketThumbnailJob): Promise<void> {
  await renderThumbnail(ticketSourcePath(job.fileName), ticketThumbnailPath(job.fileName));
}

export async function runResilientThumbnailBatch<T>(
  items: T[],
  renderer: (item: T) => Promise<void>,
): Promise<{ completed: number; failed: number }> {
  let completed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await renderer(item);
      completed += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err }, 'Miniatura histórica omitida; el backfill continúa');
    }
  }
  return { completed, failed };
}

async function backfill(job: Job): Promise<void> {
  let lastQaId = 0;
  let completed = 0;
  let failed = 0;
  while (true) {
    const rows = await prisma.qaExternaImagen.findMany({
      where: { id: { gt: lastQaId } },
      select: { id: true, programa: true, sha256: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (rows.length === 0) break;
    const batch = await runResilientThumbnailBatch(rows, (row) =>
      renderQaThumbnail({ kind: 'QA', programa: row.programa, sha256: row.sha256 }));
    completed += batch.completed;
    failed += batch.failed;
    lastQaId = rows[rows.length - 1].id;
    await job.updateProgress(Math.min(70, Math.floor(completed / 10)));
  }

  let lastAttachmentId = 0;
  while (true) {
    const rows = await prisma.ticketAttachment.findMany({
      where: { id: { gt: lastAttachmentId } },
      select: { id: true, fileUrl: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (rows.length === 0) break;
    const validRows = rows
      .map((row) => path.basename(row.fileUrl))
      .filter((fileName) => TICKET_FILE_RE.test(fileName));
    const batch = await runResilientThumbnailBatch(validRows, (fileName) =>
      renderTicketThumbnail({ kind: 'TICKET', fileName }));
    completed += batch.completed;
    failed += batch.failed;
    lastAttachmentId = rows[rows.length - 1].id;
    await job.updateProgress(Math.min(99, 70 + Math.floor(completed / 10)));
  }
  if (failed > 0) logger.warn({ completed, failed }, 'Backfill de miniaturas terminó con omisiones');
}

async function processMedia(job: Job): Promise<void> {
  const data = job.data as MediaJob;
  if (data.kind === 'QA') await renderQaThumbnail(data);
  else if (data.kind === 'TICKET') await renderTicketThumbnail(data);
  else if (data.kind === 'BACKFILL') await backfill(job);
  else throw new Error('Tipo de media job inválido');
}

async function enqueue(name: string, data: MediaJob, jobId: string): Promise<void> {
  try {
    const existing = await mediaQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') {
        await existing.remove();
      } else {
        return;
      }
    }
    await mediaQueue.add(name, data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
    });
  } catch (err) {
    // La imagen original ya quedó durable. El backfill periódico recupera una
    // publicación perdida sin hacer fallar la carga del usuario/dispositivo.
    logger.warn({ err, jobId }, 'Miniatura pendiente de backfill');
  }
}

export async function enqueueQaThumbnail(
  programa: 'BUFFALO' | 'LX',
  sha256: string,
): Promise<void> {
  if (!SHA256_RE.test(sha256)) throw new Error('Hash QA inválido');
  if (await exists(qaThumbnailPath(programa, sha256))) return;
  await enqueue(
    'qa-thumbnail',
    { kind: 'QA', programa, sha256 },
    `qa-thumb-${programa.toLowerCase()}-${sha256}`,
  );
}

export async function enqueueTicketThumbnail(fileName: string): Promise<void> {
  const safeName = path.basename(fileName);
  if (!TICKET_FILE_RE.test(safeName)) throw new Error('Nombre de evidencia inválido');
  if (await exists(ticketThumbnailPath(safeName))) return;
  await enqueue(
    'ticket-thumbnail',
    { kind: 'TICKET', fileName: safeName },
    `ticket-thumb-${path.parse(safeName).name}`,
  );
}

export async function enqueueThumbnailBackfill(): Promise<void> {
  await enqueue('thumbnail-backfill', { kind: 'BACKFILL' }, 'thumbnail-backfill-v1');
}

export async function scheduleThumbnailBackfill(): Promise<void> {
  await mediaQueue.upsertJobScheduler(
    'thumbnail-backfill-scheduler-v1',
    { every: THUMBNAIL_BACKFILL_INTERVAL_MS },
    {
      name: 'thumbnail-backfill',
      data: { kind: 'BACKFILL' },
      opts: {
        attempts: 1,
        removeOnComplete: { age: 24 * 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 100 },
      },
    },
  );
}

export function createMediaThumbnailWorker(): Worker {
  return createWorker(QUEUE_NAME, processMedia);
}

export async function closeMediaThumbnailQueue(): Promise<void> {
  await mediaQueue.close();
}

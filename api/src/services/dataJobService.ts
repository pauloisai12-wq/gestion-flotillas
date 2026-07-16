import path from 'path';
import { promises as fs } from 'fs';
import type { DataJob, DataJobType, Prisma } from '@prisma/client';
import type { Job, Queue, Worker } from 'bullmq';
import { createQueue, createWorker } from '../config/queue';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { logger } from '../lib/logger';
import { Conflict, isPrismaKnownError, NotFound } from '../middlewares/errorHandler';
import { UPLOAD_DIRS } from '../lib/uploadStorage';
import {
  importVehiclesFromFile,
  publicImportErrorMessage,
  type ImportResult,
} from './vehicleImportService';
import { refreshMaterializedViews } from '../jobs/refreshViewsJob';

const QA_EXPORT_QUEUE = 'data-jobs';
const VEHICLE_IMPORT_QUEUE = 'vehicle-imports';
const JOB_RETENTION_HOURS = 24;
const STALE_JOB_MINUTES = 15;
const ORPHAN_ARTIFACT_MIN_AGE_HOURS = 24;
export const MAX_STORED_IMPORT_ISSUES = 500;
export const MAX_STORED_IMPORT_MESSAGE_LENGTH = 500;

const FINAL_QA_ARTIFACT_RE =
  /^qa-externa-(?:buffalo|lx)-([1-9]\d*)_a[0-9a-f]{32}\.zip$/;
const TEMP_QA_ARTIFACT_RE =
  /^\.qa-externa-(?:buffalo|lx)-([1-9]\d*)_a[0-9a-f]{32}\.zip\.[0-9a-f]{32}\.tmp\.zip(?:\.[0-9a-f]{32}\.xlsx)?$/;

const qaExportQueue = createQueue(QA_EXPORT_QUEUE);
const vehicleImportQueue = createQueue(VEHICLE_IMPORT_QUEUE);

type QaExportPayload = {
  programa: 'BUFFALO' | 'LX';
  dateFrom: string;
  dateToExclusive: string;
  maxRecords: number;
};

type VehicleImportPayload = {
  maxRows: number;
};

function expiresAt(hours = JOB_RETENTION_HOURS): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function queueFor(type: DataJobType): Queue {
  return type === 'QA_EXPORT' ? qaExportQueue : vehicleImportQueue;
}

function queueJobName(type: DataJobType): string {
  return type === 'QA_EXPORT' ? 'generate-qa-export' : 'import-vehicles';
}

function queueJobId(id: number): string {
  return `data-job-${id}`;
}

export function getDataJobQueues(): Queue[] {
  return [qaExportQueue, vehicleImportQueue];
}

export async function closeDataJobQueues(): Promise<void> {
  await Promise.allSettled(getDataJobQueues().map((queue) => queue.close()));
}

async function publish(job: Pick<DataJob, 'id' | 'type'>): Promise<boolean> {
  const queue = queueFor(job.type);
  const id = queueJobId(job.id);
  const existing = await queue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      // La fila PostgreSQL sigue QUEUED: un Bull job terminal no puede ser el
      // ACK de esa intención durable. Se retira y se publica de nuevo.
      await existing.remove();
    } else {
      return false;
    }
  }

  await queue.add(
    queueJobName(job.type),
    { dataJobId: job.id },
    {
      jobId: id,
      // Una importación puede haber confirmado filas antes de un fallo de
      // infraestructura; reintentar el archivo completo no es seguro para filas
      // con un solo identificador. Los errores por fila ya son parte del resultado.
      attempts: job.type === 'VEHICLE_IMPORT' ? 1 : 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: JOB_RETENTION_HOURS * 60 * 60, count: 250 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 250 },
    },
  );
  return true;
}

async function publishBestEffort(job: Pick<DataJob, 'id' | 'type'>): Promise<boolean> {
  try {
    return await publish(job);
  } catch (err) {
    // La fila QUEUED es la intención durable; el barrido periódico volverá a
    // publicarla si Redis no estaba disponible durante la petición HTTP.
    logger.error({ err, dataJobId: job.id, type: job.type }, 'DataJob pendiente de publicación');
    return false;
  }
}

export async function createQaExportJob(input: {
  requestedById: number;
  programa: 'BUFFALO' | 'LX';
  dateFrom: Date;
  dateToExclusive: Date;
  maxRecords: number;
}): Promise<DataJob> {
  const payload: QaExportPayload = {
    programa: input.programa,
    dateFrom: input.dateFrom.toISOString(),
    dateToExclusive: input.dateToExclusive.toISOString(),
    maxRecords: input.maxRecords,
  };
  let job: DataJob;
  try {
    job = await prisma.dataJob.create({
      data: {
        type: 'QA_EXPORT',
        requestedById: input.requestedById,
        payload,
        expiresAt: expiresAt(),
      },
    });
  } catch (err) {
    if (isPrismaKnownError(err, 'P2002')) {
      throw Conflict('Ya tienes una exportación QA en cola o procesándose');
    }
    throw err;
  }
  await publishBestEffort(job);
  return job;
}

export async function createVehicleImportJob(input: {
  requestedById: number;
  inputPath: string;
  originalFileName: string;
  maxRows: number;
}): Promise<DataJob> {
  const payload: VehicleImportPayload = { maxRows: input.maxRows };
  let job: DataJob;
  try {
    job = await prisma.dataJob.create({
      data: {
        type: 'VEHICLE_IMPORT',
        requestedById: input.requestedById,
        payload,
        inputPath: input.inputPath,
        originalFileName: input.originalFileName.slice(0, 255),
        expiresAt: expiresAt(7 * 24),
      },
    });
  } catch (err) {
    if (isPrismaKnownError(err, 'P2002')) {
      throw Conflict('Ya tienes una importación de vehículos en cola o procesándose');
    }
    throw err;
  }
  await publishBestEffort(job);
  return job;
}

export function serializeDataJob(job: DataJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    originalFileName: job.originalFileName,
    artifactName: job.artifactName,
    artifactSize: job.artifactSize == null ? null : Number(job.artifactSize),
    result: job.result,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function getOwnedDataJob(
  id: number,
  requestedById: number,
  type: DataJobType,
): Promise<DataJob> {
  const job = await prisma.dataJob.findFirst({
    where: { id, requestedById, type },
  });
  if (!job) throw NotFound('Trabajo');
  return job;
}

export async function getLatestOwnedActiveDataJob(
  requestedById: number,
  type: DataJobType,
): Promise<DataJob | null> {
  return prisma.dataJob.findFirst({
    where: {
      requestedById,
      type,
      status: { in: ['QUEUED', 'PROCESSING'] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function dispatchQueuedDataJobs(limit = 50): Promise<number> {
  const queued = await prisma.dataJob.findMany({
    where: { status: 'QUEUED', expiresAt: { gt: new Date() } },
    select: { id: true, type: true },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let published = 0;
  for (const job of queued) {
    if (await publishBestEffort(job)) published += 1;
  }
  return published;
}

/**
 * Recuperación explícita tras caída de proceso:
 * - QA_EXPORT es seguro de regenerar porque publica artefactos inmutables.
 * - VEHICLE_IMPORT puede haber confirmado filas; se marca FAILED y nunca se
 *   reejecuta automáticamente.
 */
export async function recoverStaleDataJobs(limit = 25): Promise<{
  exportsRequeued: number;
  importsFailed: number;
}> {
  const cutoff = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000);
  const stale = await prisma.dataJob.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
    select: { id: true, type: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  let exportsRequeued = 0;
  let importsFailed = 0;

  for (const record of stale) {
    const queue = queueFor(record.type);
    let bullJob = null;
    let state: string | null = null;
    try {
      bullJob = await queue.getJob(queueJobId(record.id));
      state = bullJob ? await bullJob.getState() : null;
    } catch (err) {
      logger.warn({ err, dataJobId: record.id }, 'No se pudo inspeccionar DataJob stale en Redis');
      continue;
    }
    // Nunca competir con un procesador que aún conserva el lock de BullMQ.
    if (state === 'active') continue;

    if (record.type === 'QA_EXPORT') {
      const reset = await prisma.dataJob.updateMany({
        where: {
          id: record.id,
          status: 'PROCESSING',
          updatedAt: { lte: record.updatedAt },
        },
        data: {
          status: 'QUEUED',
          progress: 0,
          errorMessage: 'El worker se interrumpió; exportación reencolada automáticamente.',
          startedAt: null,
        },
      });
      exportsRequeued += reset.count;
      continue;
    }

    const failed = await prisma.dataJob.updateMany({
      where: {
        id: record.id,
        status: 'PROCESSING',
        updatedAt: { lte: record.updatedAt },
      },
      data: {
        status: 'FAILED',
        errorMessage:
          'La importación fue interrumpida y no se reintentó para evitar duplicar filas ya confirmadas.',
        completedAt: new Date(),
      },
    });
    importsFailed += failed.count;
    if (failed.count > 0 && bullJob) {
      await bullJob.remove().catch((err) => {
        logger.warn({ err, dataJobId: record.id }, 'No se pudo retirar importación interrumpida de BullMQ');
      });
    }
  }
  return { exportsRequeued, importsFailed };
}

function isInside(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removeConfined(candidate: string | null, bases: string[]): Promise<boolean> {
  if (!candidate) return true;
  if (!bases.some((base) => isInside(base, candidate))) {
    logger.error({ candidate }, 'Se rechazó limpiar una ruta de DataJob fuera de storage');
    return false;
  }
  try {
    await fs.unlink(candidate);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    logger.warn({ err, candidate }, 'No se pudo retirar artefacto vencido de DataJob');
    return false;
  }
}

export async function cleanupExpiredDataJobs(limit = 50): Promise<number> {
  const expired = await prisma.dataJob.findMany({
    where: {
      expiresAt: { lte: new Date() },
      status: { in: ['QUEUED', 'COMPLETED', 'FAILED'] },
    },
    orderBy: { expiresAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  const artifactRoot = path.join(path.resolve(env.REPORTS_DIR), 'data-jobs');
  let removed = 0;
  for (const job of expired) {
    const inputRemoved = await removeConfined(job.inputPath, [UPLOAD_DIRS.vehicleImports]);
    const artifactRemoved = await removeConfined(job.artifactPath, [artifactRoot]);
    if (inputRemoved && artifactRemoved) {
      await prisma.dataJob.delete({ where: { id: job.id } });
      removed += 1;
    }
  }
  return removed;
}

function managedQaArtifactDataJobId(fileName: string): number | null {
  const match = FINAL_QA_ARTIFACT_RE.exec(fileName) ?? TEMP_QA_ARTIFACT_RE.exec(fileName);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isManagedDataJobArtifactName(fileName: string): boolean {
  return managedQaArtifactDataJobId(fileName) !== null;
}

/**
 * Retira residuos de un worker terminado con SIGKILL. Solo admite nombres que
 * genera `generate_qa_export.py`, nunca sigue symlinks, conserva rutas
 * referenciadas y omite cualquier DataJob que siga PROCESSING.
 */
export async function cleanupOrphanedDataJobArtifacts(limit = 100): Promise<number> {
  const artifactRoot = path.join(path.resolve(env.REPORTS_DIR), 'data-jobs');
  let entries;
  try {
    entries = await fs.readdir(artifactRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }

  const tracked = await prisma.dataJob.findMany({
    where: {
      type: 'QA_EXPORT',
      OR: [{ status: 'PROCESSING' }, { artifactPath: { not: null } }],
    },
    select: { id: true, status: true, artifactPath: true },
  });
  const activeIds = new Set(
    tracked.filter((job) => job.status === 'PROCESSING').map((job) => job.id),
  );
  const referencedPaths = new Set(
    tracked
      .map((job) => job.artifactPath)
      .filter((artifactPath): artifactPath is string => artifactPath !== null)
      .map((artifactPath) => path.resolve(artifactPath)),
  );
  const cutoff = Date.now() - ORPHAN_ARTIFACT_MIN_AGE_HOURS * 60 * 60 * 1000;
  const boundedLimit = Math.min(Math.max(limit, 1), 500);
  let removed = 0;

  for (const entry of entries) {
    if (removed >= boundedLimit) break;
    if (!entry.isFile()) continue;
    const dataJobId = managedQaArtifactDataJobId(entry.name);
    if (dataJobId === null || activeIds.has(dataJobId)) continue;

    const candidate = path.join(artifactRoot, entry.name);
    if (!isInside(artifactRoot, candidate) || referencedPaths.has(path.resolve(candidate))) continue;
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs > cutoff) continue;
      await fs.unlink(candidate);
      removed += 1;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err, candidate }, 'No se pudo retirar artefacto huérfano de DataJob');
      }
    }
  }
  return removed;
}

export function sanitizeImportResultForStorage(result: ImportResult): Prisma.InputJsonObject {
  const sanitizeIssue = (issue: { row: number; message: string }) => ({
    row: issue.row,
    message: issue.message.slice(0, MAX_STORED_IMPORT_MESSAGE_LENGTH),
  });
  return {
    total: result.total,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.slice(0, MAX_STORED_IMPORT_ISSUES).map(sanitizeIssue),
    warnings: result.warnings.slice(0, MAX_STORED_IMPORT_ISSUES).map(sanitizeIssue),
    errorsTruncated: Math.max(0, result.errors.length - MAX_STORED_IMPORT_ISSUES),
    warningsTruncated: Math.max(0, result.warnings.length - MAX_STORED_IMPORT_ISSUES),
  };
}

function payloadMaxRows(payload: Prisma.JsonValue): number {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return 0;
  const value = (payload as Record<string, Prisma.JsonValue>).maxRows;
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

async function processVehicleImport(job: Job): Promise<void> {
  const dataJobId = Number(job.data?.dataJobId);
  if (!Number.isInteger(dataJobId) || dataJobId <= 0) throw new Error('dataJobId inválido');

  const record = await prisma.dataJob.findUnique({ where: { id: dataJobId } });
  if (!record || record.type !== 'VEHICLE_IMPORT') throw new Error('DataJob de importación inexistente');
  if (record.status === 'COMPLETED') return;
  if (!record.inputPath || !isInside(UPLOAD_DIRS.vehicleImports, record.inputPath)) {
    throw new Error('Ruta de importación ausente o fuera del directorio permitido');
  }

  const claim = await prisma.dataJob.updateMany({
    where: { id: record.id, type: 'VEHICLE_IMPORT', status: 'QUEUED' },
    data: {
      status: 'PROCESSING',
      progress: Math.max(record.progress, 1),
      startedAt: record.startedAt ?? new Date(),
      errorMessage: null,
    },
  });
  if (claim.count !== 1) throw new Error('DataJob de importación no reclamable');

  try {
    const maxRows = payloadMaxRows(record.payload);
    if (maxRows <= 0) throw new Error('Límite de filas inválido');
    const result = await importVehiclesFromFile(record.inputPath, {
      maxRows,
      actorUserId: record.requestedById,
      onProgress: async (progress) => {
        const bounded = Math.min(95, Math.max(1, progress));
        await job.updateProgress(bounded);
        await prisma.dataJob.updateMany({
          where: { id: record.id, status: 'PROCESSING' },
          data: { progress: bounded },
        });
      },
    });

    await refreshMaterializedViews().catch((err) => {
      logger.warn({ err, dataJobId: record.id }, 'Import OK pero falló el refresco de vistas');
    });
    const storedResult = sanitizeImportResultForStorage(result);
    await prisma.$transaction(async (tx) => {
      const completed = await tx.dataJob.updateMany({
        where: { id: record.id, status: 'PROCESSING' },
        data: {
          status: 'COMPLETED',
          progress: 100,
          result: storedResult,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      if (completed.count !== 1) throw new Error('DataJob dejó de estar PROCESSING');
      await tx.auditLog.create({
        data: {
          userId: record.requestedById,
          action: 'IMPORT',
          resource: 'Vehicle',
          metadata: {
            dataJobId: record.id,
            total: result.total,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            errors: result.errors.length,
          },
        },
      });
    });

    const inputRemoved = await removeConfined(record.inputPath, [UPLOAD_DIRS.vehicleImports]);
    if (inputRemoved) {
      await prisma.dataJob.updateMany({
        where: { id: record.id, status: 'COMPLETED', inputPath: record.inputPath },
        data: { inputPath: null },
      }).catch((err) => {
        // La ruta sigue referenciada si este ACK falla; cleanup la resolverá.
        logger.warn({ err, dataJobId: record.id }, 'No se pudo confirmar cleanup del import');
      });
    }
    await job.updateProgress(100).catch((err) => {
      logger.warn({ err, dataJobId: record.id }, 'Import completado sin ACK de progreso BullMQ');
    });
  } catch (err) {
    const attempts = job.opts.attempts ?? 1;
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    logger.error({ err, dataJobId: record.id }, 'Falló el procesamiento de importación');
    const message = publicImportErrorMessage(err, 'job');
    await prisma.dataJob.updateMany({
      where: { id: record.id, status: 'PROCESSING' },
      data: {
        status: finalAttempt ? 'FAILED' : 'QUEUED',
        errorMessage: message,
        ...(finalAttempt ? { completedAt: new Date() } : {}),
      },
    });
    if (finalAttempt) await removeConfined(record.inputPath, [UPLOAD_DIRS.vehicleImports]);
    throw err;
  }
}

export function createVehicleImportWorker(): Worker {
  return createWorker(VEHICLE_IMPORT_QUEUE, processVehicleImport);
}

import { createQueue } from '../config/queue';
import prisma from '../lib/prisma';
import { Conflict, isPrismaKnownError } from '../middlewares/errorHandler';
import { logger } from '../lib/logger';
import type { ReportHistory } from '@prisma/client';

const reportsQueue = createQueue('reports');
const REPORT_JOB_NAME = 'generate-monthly-report';
const REPORT_JOB_ATTEMPTS = 3;
const REPORT_CLAIM_TIMEOUT_MINUTES = 15;
const PUBLIC_REPORT_FAILURE = 'No se pudo generar el reporte; reintenta más tarde';

export function serializeReportHistoryForClient(report: ReportHistory) {
  return {
    id: report.id,
    month: report.month,
    year: report.year,
    // El cliente solo necesita disponibilidad; nunca recibe rutas del host.
    pdfPath: report.pdfPath ? 'available' : null,
    excelPath: report.excelPath ? 'available' : null,
    pdfSize: report.pdfSize,
    excelSize: report.excelSize,
    status: report.status,
    requestedBy: report.requestedBy,
    errorMessage: report.status === 'FAILED' ? PUBLIC_REPORT_FAILURE : null,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

type DispatchOptions = {
  reportHistoryId?: number;
  limit?: number;
};

export async function closeReportGenerationQueue(): Promise<void> {
  await reportsQueue.close();
}

function reportJobId(reportHistoryId: number, previousDispatches: number): string {
  const base = `report-history-${reportHistoryId}`;
  return previousDispatches === 0 ? base : `${base}-recovery-${previousDispatches}`;
}

/**
 * Recupera generaciones cuyo worker dejó de renovar la concesión. El outbox
 * vuelve a pendiente y publicará un job nuevo; el runToken impide que un intento
 * anterior confirme artefactos después de perder ownership.
 */
export async function recoverExpiredReportGenerations(limit = 25): Promise<number> {
  const take = Math.min(Math.max(limit, 1), 100);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT rh.id
      FROM report_history rh
      LEFT JOIN report_generation_outbox outbox
        ON outbox."reportHistoryId" = rh.id
      WHERE rh.status = 'PROCESSING'::"ReportStatus"
        AND (
          (rh."leaseExpiresAt" IS NOT NULL AND rh."leaseExpiresAt" < NOW())
          OR (
            rh."runToken" IS NULL
            AND rh."leaseExpiresAt" IS NULL
            AND outbox."publishedAt" IS NOT NULL
            AND outbox."publishedAt" < NOW()
              - (${REPORT_CLAIM_TIMEOUT_MINUTES} * INTERVAL '1 minute')
          )
        )
      ORDER BY COALESCE(rh."leaseExpiresAt", outbox."publishedAt")
      LIMIT ${take}
      FOR UPDATE OF rh SKIP LOCKED
    `;

    let recovered = 0;
    for (const report of expired) {
      const reset = await tx.reportHistory.updateMany({
        where: {
          id: report.id,
          status: 'PROCESSING',
          OR: [
            { leaseExpiresAt: { lt: now } },
            { runToken: null, leaseExpiresAt: null },
          ],
        },
        data: {
          runToken: null,
          leaseExpiresAt: null,
          errorMessage: 'El worker perdió su concesión; generación reencolada automáticamente.',
        },
      });
      if (reset.count === 0) continue;

      await tx.reportGenerationOutbox.upsert({
        where: { reportHistoryId: report.id },
        create: { reportHistoryId: report.id },
        update: {
          publishedAt: null,
          lastError: 'Concesión vencida; pendiente de reencolado automático.',
        },
      });
      recovered += 1;
    }
    return recovered;
  });
}

/**
 * Publica intenciones persistidas en PostgreSQL. Queue.add es idempotente por
 * reportHistoryId; si la API cae después del add y antes del ACK del outbox,
 * el siguiente barrido reutiliza el mismo jobId.
 */
export async function dispatchPendingReportGenerationOutbox(
  options: DispatchOptions = {},
): Promise<{ published: number; deferred: number }> {
  const entries = await prisma.reportGenerationOutbox.findMany({
    where: {
      publishedAt: null,
      ...(options.reportHistoryId
        ? { reportHistoryId: options.reportHistoryId }
        : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(options.limit ?? 25, 1), 100),
    include: {
      reportHistory: {
        select: {
          id: true,
          month: true,
          year: true,
          requestedBy: true,
          status: true,
        },
      },
    },
  });

  let published = 0;
  let deferred = 0;

  for (const entry of entries) {
    const report = entry.reportHistory;

    // Un ACK puede perderse después de que el worker cierre el reporte. En ese
    // caso se consume el outbox sin generar un intento tardío.
    if (report.status !== 'PROCESSING') {
      await prisma.reportGenerationOutbox.updateMany({
        where: { id: entry.id, publishedAt: null },
        data: {
          publishedAt: new Date(),
          lastError: `Reporte ya cerrado con estado ${report.status}`,
        },
      });
      continue;
    }

    const jobId = reportJobId(report.id, entry.attempts);
    try {
      await reportsQueue.add(
        REPORT_JOB_NAME,
        {
          reportHistoryId: report.id,
          month: report.month,
          year: report.year,
          requestedBy: report.requestedBy,
        },
        {
          jobId,
          attempts: REPORT_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );

      await prisma.reportGenerationOutbox.updateMany({
        where: { id: entry.id, publishedAt: null },
        data: {
          publishedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      published += 1;
    } catch (err) {
      deferred += 1;
      const message = err instanceof Error ? err.message : String(err);
      try {
        await prisma.reportGenerationOutbox.updateMany({
          where: { id: entry.id, publishedAt: null },
          data: {
            attempts: { increment: 1 },
            lastError: message.slice(0, 2000),
          },
        });
      } catch (persistErr) {
        // La intención original ya está durable en el outbox. Incluso si no se
        // pudo guardar el diagnóstico, el siguiente barrido volverá a verla.
        logger.error(
          { err: persistErr, reportHistoryId: report.id, jobId },
          'No se pudo actualizar el intento fallido del outbox de reportes',
        );
      }
      logger.error(
        { err, reportHistoryId: report.id, jobId },
        'No se pudo publicar el outbox de reportes; se reintentará',
      );
    }
  }

  return { published, deferred };
}

/**
 * Registra una generación mensual y su intención de cola en una transacción.
 */
export async function requestReportGeneration(
  month: number,
  year: number,
  requestedBy: string,
) {
  let report: { id: number };
  try {
    report = await prisma.$transaction(async (tx) => {
      const created = await tx.reportHistory.create({
        data: {
          month,
          year,
          requestedBy,
          status: 'PROCESSING',
        },
        select: { id: true },
      });
      await tx.reportGenerationOutbox.create({
        data: { reportHistoryId: created.id },
      });
      return created;
    });
  } catch (err) {
    if (isPrismaKnownError(err, 'P2002')) {
      throw Conflict(
        `Ya hay un reporte en proceso para ${month}/${year}. Espera a que termine.`,
      );
    }
    throw err;
  }

  const deterministicJobId = `report-history-${report.id}`;
  const dispatch = await dispatchPendingReportGenerationOutbox({
    reportHistoryId: report.id,
    limit: 1,
  });

  return {
    reportHistoryId: report.id,
    jobId: deterministicJobId,
    queued: dispatch.published === 1,
    message: dispatch.published === 1
      ? 'Reporte encolado. Se notificará al completarse.'
      : 'Solicitud registrada. El despachador reintentará la cola automáticamente.',
    month,
    year,
  };
}

/** Obtiene el historial de reportes del más reciente al más antiguo. */
export async function getReportHistory(page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;

  const [reports, total] = await Promise.all([
    prisma.reportHistory.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.reportHistory.count(),
  ]);

  return {
    data: reports.map(serializeReportHistoryForClient),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/** Obtiene un reporte específico por ID. */
export async function getReportById(id: number) {
  return prisma.reportHistory.findUnique({ where: { id } });
}

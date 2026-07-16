// Punto central donde se registran TODOS los jobs programados del sistema.

import { createQueue, createWorker } from '../config/queue';
import { runDailyComplianceCheck } from '../services/blockingService';
import { getAllPendingServices } from '../services/maintenanceService';
import { notifyManyByRole } from '../services/notificationService';
import { refreshMaterializedViews } from './refreshViewsJob';
import { closeOverdueBudgetPeriods } from '../services/budgetService';
import { BUSINESS_TIME_ZONE, businessPeriodForDate } from '../lib/businessTime';
import {
  closeReportGenerationQueue,
  dispatchPendingReportGenerationOutbox,
  recoverExpiredReportGenerations,
  requestReportGeneration,
} from '../services/reportService';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/errorHandler';
import type { Queue, Worker } from 'bullmq';
import {
  cleanupExpiredDataJobs,
  cleanupOrphanedDataJobArtifacts,
  closeDataJobQueues,
  createVehicleImportWorker,
  dispatchQueuedDataJobs,
  recoverStaleDataJobs,
} from '../services/dataJobService';
import {
  closeMediaThumbnailQueue,
  createMediaThumbnailWorker,
  scheduleThumbnailBackfill,
} from '../services/mediaThumbnailService';

// Refs vivas de colas/workers para cierre ordenado (graceful shutdown, SIGTERM).
const queues: Queue[] = [];
const workers: Worker[] = [];

/**
 * Cierra todos los workers y colas de BullMQ. Lo invoca el shutdown de la API
 * (api/src/index.ts) para no dejar jobs a medias ni conexiones Redis colgando.
 */
export async function shutdownJobs(): Promise<void> {
  logger.info('Cerrando workers y colas de BullMQ...');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(queues.map((q) => q.close()));
  await closeReportGenerationQueue();
  await closeDataJobQueues();
  await closeMediaThumbnailQueue();
  logger.info('Workers y colas de BullMQ cerrados');
}

/**
 * Calcula el mes anterior usando la misma zona horaria del negocio que los
 * presupuestos; el huso UTC del host Hetzner no decide el periodo contable.
 */
function getPreviousMonth(now: Date = new Date()): { year: number; month: number } {
  const current = businessPeriodForDate(now);
  return current.month === 1
    ? { year: current.year - 1, month: 12 }
    : { year: current.year, month: current.month - 1 };
}

export async function initializeJobs(): Promise<void> {
  logger.info('Inicializando jobs de BullMQ...');

  // ─── Cola 1: Compliance (diario a las 00:01) ───
  const complianceQueue = createQueue('compliance');
  queues.push(complianceQueue);

  const complianceWorker = createWorker('compliance', async () => {
    await runDailyComplianceCheck();

    logger.info('Revisando mantenimientos pendientes...');
    const pending = await getAllPendingServices();
    const overdue = pending.filter((s) => s.status === 'OVERDUE');
    const warning = pending.filter((s) => s.status === 'WARNING');
    logger.info(
      { overdue: overdue.length, warning: warning.length },
      'Mantenimientos: ' + overdue.length + ' vencidos, ' + warning.length + ' próximos (80%+)',
    );

    // Notificación en lote (resuelve destinatarios una vez) + dedupe diario:
    // antes eran 2×N llamadas con N+1 de usuarios y re-insertaban las mismas
    // alertas cada día.
    await notifyManyByRole({
      roles: ['SUPERVISOR_VEHICLES', 'ADMIN'],
      type: 'MAINTENANCE_OVERDUE',
      dedupeWithinHours: 20,
      items: overdue.map((s) => ({
        title: 'Mantenimiento vencido',
        message: s.economicNumber + ': ' + s.name + ' vencido por ' + Math.abs(s.remainingKm).toLocaleString() + ' km.',
        entityRef: 'vehicle:' + s.vehicleId,
      })),
    });

    await notifyManyByRole({
      roles: ['SUPERVISOR_VEHICLES', 'ADMIN'],
      type: 'MAINTENANCE_DUE',
      dedupeWithinHours: 20,
      items: warning.map((s) => ({
        title: 'Mantenimiento próximo',
        message: s.economicNumber + ': ' + s.name + ' al ' + s.progressPercent + '%. Faltan ' + s.remainingKm.toLocaleString() + ' km.',
        entityRef: 'vehicle:' + s.vehicleId,
      })),
    });
  });

  workers.push(complianceWorker);

  await complianceQueue.upsertJobScheduler(
    'daily-compliance-check',
    {
      pattern: '1 0 * * *',
      tz: BUSINESS_TIME_ZONE,
    },
    {
      name: 'daily-compliance-check',
      data: {},
      opts: {
        removeOnComplete: { count: 7 },
        removeOnFail: { count: 14 },
      },
    }
  );

  logger.info('Job "compliance" programado: todos los días a las 00:01');

  // ─── Cola 2: Refresco de vistas materializadas (cada 15 min) ───
  const viewsQueue = createQueue('refresh-views');
  queues.push(viewsQueue);

  const viewsWorker = createWorker('refresh-views', async () => {
    await refreshMaterializedViews();
  });
  workers.push(viewsWorker);

  await viewsQueue.upsertJobScheduler(
    'refresh-views-scheduler',
    {
      pattern: '*/15 * * * *',
    },
    {
      name: 'refresh-views',
      data: {},
      opts: {
        removeOnComplete: { count: 4 },
        removeOnFail: { count: 10 },
      },
    }
  );

  logger.info('Job "refresh-views" programado: cada 15 minutos');

  // ─── Cola 3: despacho mensual de reportes (día 1 a las 06:00) ───
  // El scheduler anterior escribía directamente en `reports`, por lo que el
  // worker Python recibía jobs sin ReportHistory. Ahora un worker Node crea
  // primero la fila PROCESSING y solo después encola el trabajo real.
  const legacyReportsQueue = createQueue('reports');
  await legacyReportsQueue.removeJobScheduler('monthly-report-scheduler');
  await legacyReportsQueue.close();

  const reportDispatchQueue = createQueue('report-dispatch');
  queues.push(reportDispatchQueue);
  const reportDispatchWorker = createWorker('report-dispatch', async (job) => {
    if (job.name === 'flush-report-outbox') {
      const recovered = await recoverExpiredReportGenerations(25);
      const result = await dispatchPendingReportGenerationOutbox({ limit: 50 });
      const staleDataJobs = await recoverStaleDataJobs(25);
      const dataJobsPublished = await dispatchQueuedDataJobs(50);
      const dataJobsExpired = await cleanupExpiredDataJobs(25);
      const dataJobArtifactsOrphaned = await cleanupOrphanedDataJobArtifacts(100);
      if (
        recovered > 0
        || result.published > 0
        || result.deferred > 0
        || dataJobsPublished > 0
        || dataJobsExpired > 0
        || dataJobArtifactsOrphaned > 0
        || staleDataJobs.exportsRequeued > 0
        || staleDataJobs.importsFailed > 0
      ) {
        logger.info(
          {
            recovered,
            ...result,
            staleDataJobs,
            dataJobsPublished,
            dataJobsExpired,
            dataJobArtifactsOrphaned,
          },
          'Barrido de outbox/reportes/DataJobs completado',
        );
      }
      return;
    }

    const { year, month } = getPreviousMonth();
    try {
      await requestReportGeneration(month, year, 'cron-mensual');
    } catch (err) {
      // Si un admin ya solicitó ese periodo, la barrera única cumplió su
      // objetivo: el cron no debe fallar/reintentar ni duplicar el trabajo.
      if (err instanceof AppError && err.statusCode === 409) {
        logger.info({ month, year }, 'Reporte mensual ya estaba en proceso; despacho omitido');
        return;
      }
      throw err;
    }
  });
  workers.push(reportDispatchWorker);

  await reportDispatchQueue.upsertJobScheduler(
    'monthly-report-scheduler',
    {
      pattern: '0 6 1 * *',
      tz: BUSINESS_TIME_ZONE,
    },
    {
      name: 'dispatch-monthly-report',
      data: {},
      opts: {
        removeOnComplete: { count: 12 },
        removeOnFail: { count: 12 },
      },
    }
  );

  await reportDispatchQueue.upsertJobScheduler(
    'report-outbox-scheduler',
    { pattern: '* * * * *' },
    {
      name: 'flush-report-outbox',
      data: {},
      opts: {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 20 },
      },
    },
  );

  logger.info('Jobs de reportes: mensual 06:00 + outbox cada minuto');

  // Importaciones pesadas: una sola en paralelo. El parser XLSX usa un worker
  // thread y las búsquedas de identificadores se precargan en lotes.
  const vehicleImportWorker = createVehicleImportWorker();
  workers.push(vehicleImportWorker);
  logger.info('Worker de importación de vehículos inicializado (concurrency=1)');

  const mediaThumbnailWorker = createMediaThumbnailWorker();
  workers.push(mediaThumbnailWorker);
  await scheduleThumbnailBackfill();
  logger.info('Worker de miniaturas WebP inicializado + backfill cada 15 minutos');

  // ─── Cola 4: Rollover de presupuestos (ventana tras revisión) ───
  const rolloverQueue = createQueue('budget-rollover');
  queues.push(rolloverQueue);

  const rolloverWorker = createWorker('budget-rollover', async () => {
    const result = await closeOverdueBudgetPeriods();
    logger.info(
      { periods: result.periods, currentPeriod: result.currentPeriod },
      'Barrido de periodos presupuestales vencidos completado',
    );
  });

  workers.push(rolloverWorker);

  await rolloverQueue.upsertJobScheduler(
    'monthly-rollover-scheduler',
    {
      // El cierre se difiere mientras existan cargas pendientes. El barrido
      // diario conserva meses atrasados incluso después de cambiar de mes.
      pattern: '0 6 * * *',
      tz: BUSINESS_TIME_ZONE,
    },
    {
      name: 'budget-rollover',
      data: {},
      opts: { removeOnComplete: { count: 12 }, removeOnFail: { count: 12 } },
    },
  );

  logger.info('Job "budget-rollover": barrido diario 06:00 CDMX de periodos vencidos');
  logger.info('Jobs de BullMQ inicializados');
}

// Archivo: /flotillas/api/src/jobs/index.ts
// Punto central donde se registran TODOS los jobs programados del sistema.

import { createQueue, createWorker } from '../config/queue';
import { runDailyComplianceCheck } from '../services/blockingService';
import { getAllPendingServices } from '../services/maintenanceService';
import { notifyManyByRole } from '../services/notificationService';
import { refreshMaterializedViews } from './refreshViewsJob';
import { closeMonthAndRollover } from '../services/budgetService';
import { logger } from '../lib/logger';

/**
 * Calcula año/mes del MES ANTERIOR de forma robusta, sin importar
 * cuándo se dispare el cron (resistente a timezone drift y disparos tardíos).
 * Estrategia: tomar el día 1 del mes actual y restarle 1 día → estamos en el
 * último día del mes anterior. Más confiable que aritmética manual con offsets.
 */
function getPreviousMonth(now: Date = new Date()): { year: number; month: number } {
  const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevious = new Date(firstOfCurrent.getTime() - 24 * 60 * 60 * 1000);
  return {
    year: lastOfPrevious.getFullYear(),
    month: lastOfPrevious.getMonth() + 1,
  };
}

export async function initializeJobs(): Promise<void> {
  logger.info('Inicializando jobs de BullMQ...');

  // ─── Cola 1: Compliance (diario a las 00:01) ───
  const complianceQueue = createQueue('compliance');

  createWorker('compliance', async () => {
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

  await complianceQueue.obliterate({ force: true });

  await complianceQueue.upsertJobScheduler(
    'daily-compliance-check',
    {
      pattern: '1 0 * * *',
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

  createWorker('refresh-views', async () => {
    await refreshMaterializedViews();
  });

  await viewsQueue.obliterate({ force: true });

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

  // ─── Cola 3: Reportes mensuales (día 1 a las 06:00) ───
  // NOTA: Esta cola solo ENCOLA el job en Redis.
  // El worker Python (worker/main.py) es quien lo PROCESA.
  const reportsQueue = createQueue('reports');

  await reportsQueue.obliterate({ force: true });

  await reportsQueue.upsertJobScheduler(
    'monthly-report-scheduler',
    {
      pattern: '0 6 1 * *',
    },
    {
      name: 'generate-monthly-report',
      data: {
        autoCalculateMonth: true,
      },
      opts: {
        removeOnComplete: { count: 12 },
        removeOnFail: { count: 12 },
      },
    }
  );

  logger.info('Job "reports" programado: día 1 de cada mes a las 06:00');

  // ─── Cola 4: Rollover de presupuestos (día 1 a las 00:05) ───
  const rolloverQueue = createQueue('budget-rollover');

  createWorker('budget-rollover', async () => {
    const { year: prevYear, month: prevMonth } = getPreviousMonth();
    logger.info({ year: prevYear, month: prevMonth }, 'Cerrando mes y aplicando rollover');
    const result = await closeMonthAndRollover({ year: prevYear, month: prevMonth });
    logger.info({ results: result.results }, 'Rollover aplicado');
  });

  await rolloverQueue.obliterate({ force: true });

  await rolloverQueue.upsertJobScheduler(
    'monthly-rollover-scheduler',
    { pattern: '5 0 1 * *' },
    {
      name: 'budget-rollover',
      data: {},
      opts: { removeOnComplete: { count: 12 }, removeOnFail: { count: 12 } },
    },
  );

  logger.info('Job "budget-rollover" programado: día 1 de cada mes a las 00:05');
  logger.info('Jobs de BullMQ inicializados');
}


import { createQueue } from '../config/queue';
import prisma from '../lib/prisma';
import { Conflict } from '../middlewares/errorHandler';

const reportsQueue = createQueue('reports');

/**
 * Encola un job para generar el reporte del mes indicado.
 * El worker Python lo procesará.
 */
export async function requestReportGeneration(
  month: number,
  year: number,
  requestedBy: string
) {
  // Verificar si ya existe un reporte en proceso para ese mes
  const existing = await prisma.reportHistory.findFirst({
    where: {
      month,
      year,
      status: 'PROCESSING',
    },
  });

  if (existing) {
    throw Conflict(
      'Ya hay un reporte en proceso para ' + month + '/' + year + '. Espera a que termine.'
    );
  }

  // Encolar el job
  const job = await reportsQueue.add('generate-monthly-report', {
    month,
    year,
    requestedBy,
  });

  return {
    jobId: job.id,
    message: 'Reporte encolado. Se notificará al completarse.',
    month,
    year,
  };
}

/**
 * Obtiene el historial de reportes generados, ordenados del más reciente al más antiguo.
 */
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
    data: reports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Obtiene un reporte específico por ID.
 */
export async function getReportById(id: number) {
  return prisma.reportHistory.findUnique({
    where: { id },
  });
}
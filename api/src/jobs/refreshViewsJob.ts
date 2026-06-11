// Job que refresca las vistas materializadas del dashboard cada 15 minutos

import prisma from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Refresca todas las vistas materializadas del dashboard.
 * Usa CONCURRENTLY para no bloquear lecturas mientras se actualiza (cada MV tiene
 * un índice único, requisito de REFRESH ... CONCURRENTLY).
 *
 * IMPORTANTE: si alguna vista falla, la función LANZA para que BullMQ marque el job
 * como FAILED y reintente. Antes, el `.catch()` por vista + `Promise.all` tragaban el
 * error y el job se marcaba COMPLETED aunque el dashboard quedara stale en silencio.
 */
export async function refreshMaterializedViews(): Promise<void> {
  const views = [
    'mv_dashboard_summary',
    'mv_fuel_monthly_trend',
    'mv_vehicle_ranking',
    'mv_operator_ranking',
    'mv_budget_progress',
  ];

  logger.info('Iniciando refresco de vistas materializadas...');

  // Los nombres son constantes, pero validamos contra un patrón de identificador
  // seguro antes de interpolar en $executeRawUnsafe (defensa en profundidad).
  const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

  const results = await Promise.allSettled(
    views.map(async (view) => {
      if (!SAFE_IDENTIFIER.test(view)) {
        throw new Error(`Nombre de vista no permitido: ${view}`);
      }
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${view}"`);
      logger.info({ view }, 'Vista materializada refrescada');
      return view;
    }),
  );

  const failed = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );

  if (failed.length > 0) {
    for (const f of failed) {
      logger.error({ err: f.reason }, 'Error refrescando vista materializada');
    }
    // Propaga para que BullMQ registre el fallo y reintente (no fallar en silencio).
    throw new Error(
      `Refresco de vistas materializadas falló: ${failed.length}/${views.length} con error`,
    );
  }

  logger.info('Refresco de vistas materializadas completado');
}

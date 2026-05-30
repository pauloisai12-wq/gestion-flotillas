// Archivo: api/src/jobs/refreshViewsJob.ts
// Propósito: Job que refresca las vistas materializadas del dashboard cada 15 minutos
// REEMPLAZA: N/A — archivo nuevo

import prisma from '../lib/prisma';

/**
 * Refresca todas las vistas materializadas del dashboard.
 * Usa CONCURRENTLY para no bloquear lecturas mientras se actualiza.
 */
export async function refreshMaterializedViews(): Promise<void> {
  const views = [
    'mv_dashboard_summary',
    'mv_fuel_monthly_trend',
    'mv_vehicle_ranking',
    'mv_operator_ranking',
    'mv_budget_progress',
  ];

  console.log('[RefreshViews] Iniciando refresco de vistas materializadas...');

  // Refresco en paralelo: cada vista corre en su propia conexión del pool.
  // Los nombres son constantes hardcodeadas, pero validamos contra un patrón de
  // identificador seguro antes de interpolar en $executeRawUnsafe: defensa por si
  // alguna vez `views` llegara a poblarse desde config/BD (jamás debe).
  const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
  await Promise.all(
    views.map((view) => {
      if (!SAFE_IDENTIFIER.test(view)) {
        return Promise.reject(new Error(`Nombre de vista no permitido: ${view}`));
      }
      return prisma
        .$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${view}"`)
        .then(() => console.log(`[RefreshViews] ✅ ${view} refrescada`))
        .catch((error) =>
          console.error(`[RefreshViews] ❌ Error refrescando ${view}:`, error),
        );
    }),
  );

  console.log('[RefreshViews] Refresco completado.');
}
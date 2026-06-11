// Refresca las 5 vistas materializadas del dashboard a demanda.
//
// El dashboard (Total unidades, rankings, tendencias, presupuesto) NO lee la
// tabla en vivo: lee vistas materializadas que el cron `refresh-views` actualiza
// cada 15 min. Por eso, justo después de un wipe o de una importación, el
// dashboard puede mostrar el número ANTERIOR hasta el siguiente refresco.
//
// Este script fuerza el refresco YA, reusando la misma función del cron.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm api node dist/scripts/refresh-views.js
//
// En dev (con tsx):
//   npx tsx src/scripts/refresh-views.ts

import 'dotenv/config';
import prisma from '../lib/prisma';
import { refreshMaterializedViews } from '../jobs/refreshViewsJob';

async function main(): Promise<void> {
  await refreshMaterializedViews();
  console.log('✅ Vistas materializadas refrescadas. El dashboard ya refleja el estado real de la base.');
}

main()
  .catch((e) => {
    console.error('❌ Error refrescando las vistas materializadas:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

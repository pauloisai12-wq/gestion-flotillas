// Reset de datos OPERATIVOS para una carga inicial limpia (NO toca usuarios).
//
// Borra vehículos y todo lo que cuelga de ellos en el orden de FK correcto,
// replicando la misma secuencia auditada del endpoint POST /admin/wipe-operational
// (api/src/routes/adminRouter.ts). Pensado para el escenario "la importación
// inicial quedó sucia (duplicados -DUP-) y quiero re-cargar desde cero".
//
// EXIGE confirmación explícita por entorno para no borrar por accidente:
//   WIPE_CONFIRM="BORRAR TODO"
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm -e WIPE_CONFIRM="BORRAR TODO" \
//     api node dist/scripts/wipe-operational.js
//
// En dev (con tsx):
//   WIPE_CONFIRM="BORRAR TODO" npx tsx src/scripts/wipe-operational.ts
//
// Tras correrlo, vuelve a importar el Excel UNA vez con el código corregido:
// el upsert ahora es idempotente, así que re-subir el mismo archivo actualiza
// en lugar de recrear.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.WIPE_CONFIRM !== 'BORRAR TODO') {
    console.error('❌ Confirmación requerida. Re-ejecuta con: WIPE_CONFIRM="BORRAR TODO"');
    process.exit(1);
  }

  // Orden FK-seguro: dependientes primero, vehicles al final. Se preservan
  // usuarios. NO se borran operadores/estaciones/talleres/catálogos: solo lo
  // que la importación de vehículos pudo crear o lo que apunta a vehicles.
  const steps: [string, () => Promise<{ count: number }>][] = [
    ['vehicle_notes', () => prisma.vehicleNote.deleteMany({})],
    ['fuel_loads', () => prisma.fuelLoad.deleteMany({})],
    ['maintenance_records', () => prisma.maintenanceRecord.deleteMany({})],
    ['maintenance_tickets', () => prisma.maintenanceTicket.deleteMany({})],
    ['vehicle_assignments', () => prisma.vehicleAssignment.deleteMany({})],
    ['documents', () => prisma.document.deleteMany({})],
    ['vehicle_budgets', () => prisma.vehicleBudget.deleteMany({})],
    ['vehicles', () => prisma.vehicle.deleteMany({})],
  ];

  const counts: Record<string, number> = {};
  for (const [name, fn] of steps) {
    const r = await fn();
    counts[name] = r.count;
    console.log(`  ${name}: ${r.count} borrados`);
  }

  console.log('✅ Reset completado. Vuelve a importar el Excel una sola vez.');
  console.table(counts);
}

main()
  .catch((e) => {
    console.error('❌ Error en el reset:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

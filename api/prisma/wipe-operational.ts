// Borra datos operativos manteniendo: users, schema, catálogos base
// Uso: cd api && npx tsx prisma/wipe-operational.ts

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Guardia contra ejecución accidental en producción
if (process.env.NODE_ENV === 'production') {
  console.error('❌ wipe-operational.ts NO se puede ejecutar con NODE_ENV=production');
  process.exit(1);
}

const prisma = new PrismaClient(); // DATABASE_URL del .env

async function main() {
  console.log('🧹 Wipe operacional iniciando...');

  // Orden respetando foreign keys
  const steps: [string, () => Promise<{ count: number }>][] = [
    ['notifications', () => prisma.notification.deleteMany({})],
    ['vehicle_notes', () => prisma.vehicleNote.deleteMany({})],
    ['fuel_loads', () => prisma.fuelLoad.deleteMany({})],
    ['maintenance_records', () => prisma.maintenanceRecord.deleteMany({})],
    ['vehicle_assignments', () => prisma.vehicleAssignment.deleteMany({})],
    ['documents', () => prisma.document.deleteMany({})],
    ['vehicle_budgets', () => prisma.vehicleBudget.deleteMany({})],
    ['monthly_budgets', () => prisma.monthlyBudget.deleteMany({})],
    ['report_history', () => prisma.reportHistory.deleteMany({})],
    ['vehicles', () => prisma.vehicle.deleteMany({})],
    ['operators', () => prisma.operator.deleteMany({})],
    ['approved_stations', () => prisma.approvedStation.deleteMany({})],
    ['workshops', () => prisma.workshop.deleteMany({})],
    ['service_catalog', () => prisma.serviceCatalog.deleteMany({})],
    ['sectors', () => prisma.sector.deleteMany({})],
    ['vehicle_types', () => prisma.vehicleType.deleteMany({})],
  ];

  for (const [name, fn] of steps) {
    const r = await fn();
    console.log(`   ✔ ${name}: ${r.count} registros eliminados`);
  }

  // Refresh de vistas materializadas para reflejar BD vacía
  console.log('🔄 Refrescando vistas materializadas...');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_dashboard_summary');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_fuel_monthly_trend');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_vehicle_ranking');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_operator_ranking');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_budget_progress');

  // Cuántos usuarios quedaron
  const userCount = await prisma.user.count();
  console.log('');
  console.log('========================================');
  console.log('✅ Wipe completado.');
  console.log(`   ${userCount} usuario(s) preservados.`);
  console.log('========================================');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// Pobla documentos de demo para los primeros N vehículos.
// Distribución: 70% vigentes / 20% por vencer / 10% vencidos.
// Uso: npx tsx prisma/demo-documents.ts [cantidad]

import 'dotenv/config';
import { PrismaClient, DocumentType } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://flotillas_user:flotillas_pass_2026@localhost:5433/flotillas_db' } },
});

async function main() {
  const limit = parseInt(process.argv[2] || '100', 10);
  console.log(`🎲 Generando documentos demo para ${limit} vehículos…`);

  const vehicles = await prisma.vehicle.findMany({ select: { id: true }, take: limit });
  if (vehicles.length === 0) {
    console.log('No hay vehículos en BD. Importa primero.');
    return;
  }

  const docTypes: DocumentType[] = ['INVOICE', 'INSURANCE', 'VERIFICATION', 'CIRCULATION_CARD'];
  const now = new Date();
  let count = 0;

  for (const v of vehicles) {
    for (const docType of docTypes) {
      const r = Math.random();
      let expiresAt: Date;
      if (r < 0.7) {
        expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + 31 + Math.floor(Math.random() * 300));
      } else if (r < 0.9) {
        expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + 1 + Math.floor(Math.random() * 30));
      } else {
        expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() - (1 + Math.floor(Math.random() * 60)));
      }
      const issuedAt = new Date(expiresAt);
      issuedAt.setFullYear(issuedAt.getFullYear() - 1);
      await prisma.document.create({ data: { vehicleId: v.id, type: docType, issuedAt, expiresAt } });
      count++;
    }
  }

  console.log(`   ✅ ${count} documentos creados`);

  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW mv_dashboard_summary');
  console.log('   ✅ vista materializada refrescada');
}

main().catch(console.error).finally(() => prisma.$disconnect());

// /api/prisma/add-ticket-test-data.ts
// Script one-shot — agrega datos de prueba para el flujo de tickets sin
// borrar nada de lo existente.
//
// Uso: cd api && npx tsx prisma/add-ticket-test-data.ts
//
// Idempotente: si ya existen los usuarios (mismo email) no falla, los actualiza.
// Si ya hay vehículos con executorId, no los reasigna.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://flotillas_user:flotillas_pass_2026@localhost:5433/flotillas_db' },
  },
});

const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

async function main() {
  console.log('🌱 Sembrando datos de prueba para tickets de mantenimiento...\n');

  // ── 1. Crear 3 cuentas de Taller (vinculadas a los 3 primeros workshops) ──
  const workshops = await prisma.workshop.findMany({
    orderBy: { id: 'asc' },
    take: 3,
    include: { user: true },
  });
  if (workshops.length < 3) {
    throw new Error('Se necesitan al menos 3 workshops en la BD. Corre primero el seed principal.');
  }

  console.log('🔧 Cuentas de taller:');
  const pass = await bcrypt.hash('taller123', ROUNDS);
  for (let i = 0; i < 3; i++) {
    const w = workshops[i];
    const email = `taller${i + 1}@flotillas.com`;

    if (w.user) {
      console.log(`   ⚠ Workshop "${w.legalName}" ya tiene usuario (${w.user.email}) — skip`);
      continue;
    }

    // Buscar si ya existe un user con ese email
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`   ⚠ Usuario ${email} ya existe — skip`);
      continue;
    }

    await prisma.user.create({
      data: {
        email,
        passwordHash: pass,
        fullName: `Operador de ${w.tradeName || w.legalName.split(' S.A.')[0]}`,
        role: 'WORKSHOP',
        workshopId: w.id,
      },
    });
    console.log(`   ✅ ${email}  → ${w.legalName}`);
  }

  // ── 2. Crear 2 cuentas de Ejecutor ────────────────────────────────────────
  console.log('\n🛠  Cuentas de ejecutor:');
  const executorPass = await bcrypt.hash('ejecutor123', ROUNDS);

  const executor1 = await prisma.user.upsert({
    where: { email: 'ejecutor1@flotillas.com' },
    update: { role: 'EXECUTOR' },
    create: {
      email: 'ejecutor1@flotillas.com',
      passwordHash: executorPass,
      fullName: 'Carlos Hernández (Ejecutor Centro)',
      role: 'EXECUTOR',
    },
  });
  console.log(`   ✅ ${executor1.email}`);

  const executor2 = await prisma.user.upsert({
    where: { email: 'ejecutor2@flotillas.com' },
    update: { role: 'EXECUTOR' },
    create: {
      email: 'ejecutor2@flotillas.com',
      passwordHash: executorPass,
      fullName: 'Mónica Ríos (Ejecutor Norte)',
      role: 'EXECUTOR',
    },
  });
  console.log(`   ✅ ${executor2.email}`);

  // ── 3. Asignar vehículos a los ejecutores ─────────────────────────────────
  // Solo asigna vehículos que aún no tienen executorId.
  console.log('\n🚗 Asignando vehículos a ejecutores:');
  const unassigned = await prisma.vehicle.findMany({
    where: { executorId: null, isActive: true },
    orderBy: { id: 'asc' },
    take: 10,
  });

  if (unassigned.length < 10) {
    console.log(`   ⚠ Solo ${unassigned.length} vehículos sin ejecutor disponibles`);
  }

  for (let i = 0; i < unassigned.length; i++) {
    const executor = i < 5 ? executor1 : executor2;
    await prisma.vehicle.update({
      where: { id: unassigned[i].id },
      data: { executorId: executor.id },
    });
  }
  console.log(`   ✅ Asignados ${unassigned.length} vehículos (5 a cada ejecutor)`);

  // ── 4. Resumen ────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('🎉 Datos de prueba listos');
  console.log('========================================\n');
  console.log('Credenciales nuevas:');
  console.log('  ejecutor1@flotillas.com  / ejecutor123  (EXECUTOR, 5 vehículos)');
  console.log('  ejecutor2@flotillas.com  / ejecutor123  (EXECUTOR, 5 vehículos)');
  console.log('  taller1@flotillas.com    / taller123    (WORKSHOP)');
  console.log('  taller2@flotillas.com    / taller123    (WORKSHOP)');
  console.log('  taller3@flotillas.com    / taller123    (WORKSHOP)');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

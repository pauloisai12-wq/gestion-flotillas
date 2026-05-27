// Crea o actualiza un usuario en la BD
// Uso:
//   cd api && npx tsx prisma/add-user.ts <email> <password> "<Nombre completo>" <ROL>
// Ejemplos:
//   npx tsx prisma/add-user.ts tester@flotillas.com test123 "Usuario de Prueba" ADMIN
//   npx tsx prisma/add-user.ts juan@flotillas.com 123 "Juan Pérez" SUPERVISOR_VEHICLES
//
// Roles válidos: ADMIN | SUPERVISOR_VEHICLES | SUPERVISOR_FUEL | SUPERVISOR_MAINTENANCE

import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://flotillas_user:flotillas_pass_2026@localhost:5433/flotillas_db' },
  },
});

const VALID_ROLES: UserRole[] = ['ADMIN', 'SUPERVISOR_VEHICLES', 'SUPERVISOR_FUEL', 'SUPERVISOR_MAINTENANCE'];

async function main() {
  const [email, password, fullName, role] = process.argv.slice(2);

  if (!email || !password || !fullName || !role) {
    console.error('❌ Faltan argumentos.');
    console.error('   Uso: npx tsx prisma/add-user.ts <email> <password> "<Nombre>" <ROL>');
    console.error('   Roles: ' + VALID_ROLES.join(' | '));
    process.exit(1);
  }

  if (!VALID_ROLES.includes(role as UserRole)) {
    console.error(`❌ Rol inválido: ${role}`);
    console.error('   Válidos: ' + VALID_ROLES.join(' | '));
    process.exit(1);
  }

  if (password.length < 4) {
    console.error('❌ Password debe tener al menos 4 caracteres');
    process.exit(1);
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, rounds);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const user = await prisma.user.update({
      where: { email },
      data: { passwordHash, fullName, role: role as UserRole, isActive: true },
    });
    console.log(`✏️  Usuario actualizado:`);
    console.log(`   id: ${user.id}`);
    console.log(`   email: ${user.email}`);
    console.log(`   nombre: ${user.fullName}`);
    console.log(`   rol: ${user.role}`);
  } else {
    const user = await prisma.user.create({
      data: { email, passwordHash, fullName, role: role as UserRole },
    });
    console.log(`✅ Usuario creado:`);
    console.log(`   id: ${user.id}`);
    console.log(`   email: ${user.email}`);
    console.log(`   nombre: ${user.fullName}`);
    console.log(`   rol: ${user.role}`);
  }

  console.log(`\n   Login en: http://localhost:3000/login`);
  console.log(`   Password: ${password}`);
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());

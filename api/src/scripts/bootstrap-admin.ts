// Crea/actualiza el usuario ADMIN inicial a partir de variables de entorno.
//
// A diferencia del seed demo (que está bloqueado con NODE_ENV=production y crea
// datos de ejemplo), este script es la forma APTA PARA PRODUCCIÓN de dar de alta
// la primera cuenta para poder iniciar sesión y empezar a cargar datos reales.
// Es idempotente: re-ejecutarlo actualiza la contraseña/estado del admin.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm \
//     -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='unaClaveFuerte' \
//     api node dist/scripts/bootstrap-admin.js
//
// En dev (con tsx):
//   npx tsx src/scripts/bootstrap-admin.ts
//
// No imprime la contraseña. Lee BCRYPT_ROUNDS si está definida (default 12).

import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || 'Administrador';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('❌ ADMIN_EMAIL ausente o inválido.');
    console.error('   Uso: ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD="..." node dist/scripts/bootstrap-admin.js');
    process.exit(1);
  }
  if (!password || password.length < 12) {
    console.error('❌ ADMIN_PASSWORD ausente o demasiado corta (mínimo 12 caracteres).');
    process.exit(1);
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, rounds);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.ADMIN, isActive: true },
    create: { email, passwordHash, fullName, role: UserRole.ADMIN },
  });

  console.log(`✅ Admin listo: ${user.email} (rol ${user.role}). Ya puedes iniciar sesión en la app.`);
}

main()
  .catch((e) => {
    console.error('❌ Error creando el admin:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

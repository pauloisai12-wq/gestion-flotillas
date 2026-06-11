// Crea/actualiza UN usuario con cualquier rol a partir de variables de entorno.
//
// Complemento de bootstrap-admin.ts: aquel solo da de alta el ADMIN inicial;
// este registra accesos de supervisores/ejecutores/talleres SIN correr el seed
// demo (no toca vehículos ni catálogos). Es idempotente: re-ejecutarlo con el
// mismo correo actualiza contraseña, rol y estado.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm \
//     -e USER_EMAIL=correo@dominio.com -e USER_PASSWORD='unaClaveFuerte12+' \
//     -e USER_NAME='Nombre Apellido' -e USER_ROLE=SUPERVISOR_FUEL \
//     api node dist/scripts/create-user.js
//
// Roles válidos: ADMIN, SUPERVISOR_VEHICLES, SUPERVISOR_FUEL,
// SUPERVISOR_MAINTENANCE, EXECUTOR, WORKSHOP.
// Para WORKSHOP es obligatorio USER_WORKSHOP_ID (id de un taller existente;
// el CHECK constraint de la BD exige la relación 1:1 usuario-taller).
//
// No imprime la contraseña. Lee BCRYPT_ROUNDS si está definida (default 12).

import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ROLES = Object.values(UserRole);

async function main(): Promise<void> {
  const email = process.env.USER_EMAIL?.trim().toLowerCase();
  const password = process.env.USER_PASSWORD;
  const fullName = process.env.USER_NAME?.trim();
  const roleRaw = process.env.USER_ROLE?.trim().toUpperCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('❌ USER_EMAIL ausente o inválido.');
    console.error('   Uso: USER_EMAIL=correo@dominio.com USER_PASSWORD="..." USER_ROLE=EXECUTOR node dist/scripts/create-user.js');
    process.exit(1);
  }
  if (!password || password.length < 12) {
    console.error('❌ USER_PASSWORD ausente o demasiado corta (mínimo 12 caracteres).');
    process.exit(1);
  }
  if (!roleRaw || !ROLES.includes(roleRaw as UserRole)) {
    console.error(`❌ USER_ROLE ausente o inválido. Válidos: ${ROLES.join(', ')}`);
    process.exit(1);
  }
  const role = roleRaw as UserRole;

  // WORKSHOP exige taller asociado (1:1, CHECK constraint en la migración).
  let workshopId: number | null = null;
  if (role === UserRole.WORKSHOP) {
    workshopId = Number(process.env.USER_WORKSHOP_ID);
    if (!Number.isInteger(workshopId) || workshopId <= 0) {
      console.error('❌ Para USER_ROLE=WORKSHOP es obligatorio USER_WORKSHOP_ID (entero > 0).');
      process.exit(1);
    }
    const workshop = await prisma.workshop.findUnique({ where: { id: workshopId } });
    if (!workshop) {
      console.error(`❌ No existe un taller con id ${workshopId}. Créalo primero en la app (vista Talleres).`);
      process.exit(1);
    }
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, rounds);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role,
      isActive: true,
      workshopId,
      ...(fullName ? { fullName } : {}),
    },
    create: {
      email,
      passwordHash,
      fullName: fullName || email.split('@')[0],
      role,
      workshopId,
    },
  });

  console.log(`✅ Usuario listo: ${user.email} (rol ${user.role}). Ya puede iniciar sesión en la app.`);
  if (role === UserRole.EXECUTOR) {
    console.log('ℹ️  Un EXECUTOR solo ve los vehículos que tenga asignados (asignación en la vista de Vehículos).');
  }
}

main()
  .catch((e) => {
    console.error('❌ Error creando el usuario:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

// Crea/actualiza UN usuario REVISOR_QA a partir de variables de entorno.
//
// Espejo de create-user.ts, pero con el rol FIJO en REVISOR_QA: este perfil solo
// revisa la evidencia de qa_externa (listado + export ZIP); está aislado del
// resto de /uploads. Es idempotente: re-ejecutarlo con el mismo correo actualiza
// contraseña y reactiva la cuenta.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm \
//     -e QA_REVIEWER_EMAIL=correo@dominio.com \
//     -e QA_REVIEWER_PASSWORD='unaClaveFuerte12+' \
//     -e QA_REVIEWER_NAME='Nombre Apellido' \
//     api node dist/scripts/qa-reviewer-create.js
//
// No imprime la contraseña. Lee BCRYPT_ROUNDS si está definida (default 12).

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.QA_REVIEWER_EMAIL?.trim().toLowerCase();
  const password = process.env.QA_REVIEWER_PASSWORD;
  const name = process.env.QA_REVIEWER_NAME?.trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('❌ QA_REVIEWER_EMAIL ausente o inválido.');
    console.error('   Uso: QA_REVIEWER_EMAIL=correo@dominio.com QA_REVIEWER_PASSWORD="..." node dist/scripts/qa-reviewer-create.js');
    process.exit(1);
  }
  if (!password || password.length < 12) {
    console.error('❌ QA_REVIEWER_PASSWORD ausente o demasiado corta (mínimo 12 caracteres).');
    process.exit(1);
  }

  const fullName = name || email.split('@')[0];
  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, rounds);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'REVISOR_QA',
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      fullName,
      role: 'REVISOR_QA',
    },
  });

  console.log(`✅ Revisor QA listo: ${user.email} (rol ${user.role}). Ya puede iniciar sesión en la app.`);
}

main()
  .catch((e) => {
    console.error('❌ Error creando el revisor QA:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

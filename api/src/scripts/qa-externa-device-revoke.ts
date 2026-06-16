// Revoca (desactiva) uno o más dispositivos qa_externa por id o por nombre.
//
//   $COMPOSE run --rm -e DEVICE_ID=3 api node dist/scripts/qa-externa-device-revoke.js
//   $COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api node dist/scripts/qa-externa-device-revoke.js

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const idRaw = process.env.DEVICE_ID;
  const name = process.env.DEVICE_NAME?.trim();

  if (!idRaw && !name) {
    console.error('❌ Indica DEVICE_ID=<n> o DEVICE_NAME="<nombre>".');
    process.exit(1);
  }

  let count: number;
  if (idRaw) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      console.error('❌ DEVICE_ID debe ser un entero > 0.');
      process.exit(1);
    }
    ({ count } = await prisma.qaExternaDispositivo.updateMany({
      where: { id },
      data: { activo: false },
    }));
  } else {
    ({ count } = await prisma.qaExternaDispositivo.updateMany({
      where: { identificador: name },
      data: { activo: false },
    }));
  }

  console.log(
    count > 0
      ? `✅ Revocados ${count} dispositivo(s).`
      : 'ℹ️  No se encontró ningún dispositivo con ese criterio.',
  );
}

main()
  .catch((e) => {
    console.error('❌ Error revocando el dispositivo:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

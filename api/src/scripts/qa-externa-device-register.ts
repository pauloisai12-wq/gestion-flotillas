// Registra un dispositivo qa_externa y emite su API key UNA sola vez.
// Persiste solo el hash (hashDeviceKey). Mismo patrón que create-user.ts.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" \
//     api node dist/scripts/qa-externa-device-register.js
//
// Si usas QA_EXTERNA_KEY_PEPPER en la API, pásalo también aquí (-e) para que el
// hash coincida.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hashDeviceKey } from '../lib/deviceKeyHash';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const name = process.env.DEVICE_NAME?.trim();
  if (!name) {
    console.error('❌ DEVICE_NAME ausente.');
    console.error('   Uso: DEVICE_NAME="camara-zona-norte" node dist/scripts/qa-externa-device-register.js');
    process.exit(1);
  }

  const key = randomBytes(32).toString('base64url');
  const keyHash = hashDeviceKey(key);

  const device = await prisma.qaExternaDispositivo.create({
    data: { identificador: name, keyHash },
  });

  console.log(`✅ Dispositivo registrado: ${device.identificador} (id ${device.id}).`);
  console.log('');
  console.log('   API KEY (cópiala AHORA — NO SE VOLVERÁ A MOSTRAR):');
  console.log(`   ${key}`);
  console.log('');
  console.log('   Configúrala en la app como header: Authorization: Bearer <API KEY>');
}

main()
  .catch((e) => {
    console.error('❌ Error registrando el dispositivo:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

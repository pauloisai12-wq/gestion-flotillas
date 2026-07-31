// Registra un dispositivo de Encuestas Okrean y emite su API key UNA sola vez.
// Persiste solo el hash (hashEncuestasDeviceKey). Mismo patrón que
// qa-externa-device-register.ts, pero SIN programa: este padrón no tiene esa
// dimensión.
//
// En el servidor (imagen prod):
//   $COMPOSE run --rm -e DEVICE_NAME="encuestador-01" \
//     api node dist/scripts/encuestas-device-register.js
//
// Si usas ENCUESTAS_KEY_PEPPER en la API, pásalo también aquí (-e) para que el
// hash coincida.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hashEncuestasDeviceKey } from '../lib/encuestasKeyHash';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const name = process.env.DEVICE_NAME?.trim();
  if (!name) {
    console.error('❌ DEVICE_NAME ausente.');
    console.error('   Uso: DEVICE_NAME="encuestador-01" node dist/scripts/encuestas-device-register.js');
    process.exit(1);
  }

  const key = randomBytes(32).toString('base64url');
  const keyHash = hashEncuestasDeviceKey(key);

  const device = await prisma.encuestaDispositivo.create({
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

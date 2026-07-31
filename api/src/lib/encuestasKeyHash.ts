// Hash de las API keys de dispositivo de Encuestas Okrean. ÚNICO punto de
// verdad: lo usan tanto el guard (encuestasDeviceAuthMiddleware) como los CLIs
// de alta. Si el alta y la verificación hashearan distinto, ningún dispositivo
// autenticaría.
//
// Pepper PROPIO (ENCUESTAS_KEY_PEPPER), independiente del de qa_externa: los
// dos padrones de dispositivos están separados y rotar uno no debe invalidar
// las keys del otro.
//
// Las keys son tokens aleatorios de 256 bits (sin diccionario que atacar), así
// que SHA-256 indexado basta y permite lookup O(1). Con ENCUESTAS_KEY_PEPPER
// definido se usa HMAC-SHA256 (defensa en profundidad ante fuga de la BD).

import { createHash, createHmac } from 'crypto';

export function hashEncuestasDeviceKey(key: string): string {
  const pepper = process.env.ENCUESTAS_KEY_PEPPER;
  return pepper
    ? createHmac('sha256', pepper).update(key).digest('hex')
    : createHash('sha256').update(key).digest('hex');
}

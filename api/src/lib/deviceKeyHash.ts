// Hash de las API keys de dispositivo qa_externa. ÚNICO punto de verdad:
// lo usan tanto el guard (deviceAuthMiddleware) como los CLIs de alta. Si el
// alta y la verificación hashearan distinto, ningún dispositivo autenticaría.
//
// Las keys son tokens aleatorios de 256 bits (sin diccionario que atacar), así
// que SHA-256 indexado basta y permite lookup O(1). Con QA_EXTERNA_KEY_PEPPER
// definido se usa HMAC-SHA256 (defensa en profundidad ante fuga de la BD).

import { createHash, createHmac } from 'crypto';

export function hashDeviceKey(key: string): string {
  const pepper = process.env.QA_EXTERNA_KEY_PEPPER;
  return pepper
    ? createHmac('sha256', pepper).update(key).digest('hex')
    : createHash('sha256').update(key).digest('hex');
}

// Inicialización de Sentry para el backend.
//
// IMPORTANTE: este archivo debe importarse PRIMERO en src/index.ts, antes que
// express, prisma o cualquier otro módulo — Sentry instrumenta libs en su init.
//
// Si SENTRY_DSN está vacío, Sentry no se activa (modo dev sin telemetría).
// Esto evita errores en local y deja el código listo para producción.

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { env } from '../config/env';

// env.ts ya validó el formato del DSN. Si está vacío, Sentry no se activa.
const dsn = env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: env.NODE_ENV,
    integrations: [nodeProfilingIntegration()],
    // Captura del 10% de transacciones en prod, todas en dev/test.
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: 0.1,
    // No mandes secretos al servicio externo
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.log('[Sentry] Inicializado para entorno:', env.NODE_ENV);
}

export { Sentry };
export const isSentryEnabled = Boolean(dsn);

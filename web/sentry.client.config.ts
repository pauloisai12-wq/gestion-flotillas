// Sentry — runtime browser
// Carga vía instrumentation-client.ts (Next 16+)
//
// OPTIMIZACIÓN: NO usamos replayIntegration (graba sesiones del usuario).
// Pesa ~300 KB en el bundle y para esta fase de pruebas internas con
// usuarios conocidos no aporta valor. Si se necesita más adelante:
//
//   import { replayIntegration } from '@sentry/nextjs';
//   integrations: [replayIntegration({ maskAllText: true, blockAllMedia: true })]
//   replaysSessionSampleRate: 0.0,
//   replaysOnErrorSampleRate: 1.0,

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

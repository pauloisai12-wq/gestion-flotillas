// Sentry — runtime Edge (middleware.ts y edge route handlers)

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

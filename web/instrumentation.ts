// Next.js instrumentation — carga Sentry según el runtime (Node/Edge)
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// `onRequestError` (hook nuevo de Next 15+) no está expuesto en
// @sentry/nextjs v10. Cuando se actualice el SDK puede re-exportarse
// para capturar errores de server-side rendering automáticamente.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

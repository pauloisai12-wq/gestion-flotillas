// /api/src/index.ts
// Punto de entrada API v2 — hardened
// Carga env validado primero (puede abortar si faltan vars críticas)

import { env } from './config/env';

// Sentry DEBE inicializarse antes que express y el resto de módulos —
// se importa solo por su efecto secundario (Sentry.init()).
import './lib/sentry';
import * as Sentry from '@sentry/node';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';

import authRouter from './routes/authRouter';
import vehicleTypeRouter from './routes/vehicleTypeRouter';
import vehicleRouter from './routes/vehicleRouter';
import vehicleNoteRouter from './routes/vehicleNoteRouter';
import vehicleImportRouter from './routes/vehicleImportRouter';
import operatorRouter from './routes/operatorRouter';
import stationRouter from './routes/stationRouter';
import workshopRouter from './routes/workshopRouter';
import sectorRouter from './routes/sectorRouter';
import documentRouter from './routes/documentRouter';
import fuelLoadRouter from './routes/fuelLoadRouter';
import dashboardRouter from './routes/dashboardRouter';
import budgetRouter from './routes/budgetRouter';
import serviceCatalogRouter from './routes/serviceCatalogRouter';
import maintenanceRouter from './routes/maintenanceRouter';
import notificationRouter from './routes/notificationRouter';
import reportRouter from './routes/reportRouter';
import publicRouter from './routes/publicRouter';
import auditLogRouter from './routes/auditLogRouter';
import adminRouter from './routes/adminRouter';
import docsRouter from './routes/docsRouter';
import maintenanceTicketRouter from './routes/maintenanceTicketRouter';
import ticketQuoteRouter from './routes/ticketQuoteRouter';

import { initializeJobs } from './jobs';
import { authMiddleware } from './middlewares/authMiddleware';
import { errorHandler } from './middlewares/errorHandler';
import { logger, httpLoggerMiddleware } from './lib/logger';
import { healthHandler } from './lib/health';

const app = express();

// ═══════════════════════════════════════════════════
// 1. Headers de seguridad (Helmet)
// ═══════════════════════════════════════════════════
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind genera inline styles
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"], // anti clickjacking
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // permite cargar imágenes externas
    hsts: env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

// Hide X-Powered-By
app.disable('x-powered-by');

// ═══════════════════════════════════════════════════
// 2. CORS — específico por dominio
// ═══════════════════════════════════════════════════
// Dominios de ngrok permitidos en cualquier subdominio.
// Útil para exponer el sitio con `ngrok http 3000` durante pruebas.
const NGROK_ORIGIN_REGEX = /^https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.(app|dev|io)$/i;

app.use(
  cors({
    origin: (origin, cb) => {
      // Permitir requests sin origin (curl, mobile apps)
      if (!origin) return cb(null, true);
      if (env.CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      // Subdominios de ngrok: SOLO fuera de producción (en prod los túneles
      // son públicos y permitirlos abriría CSRF al API).
      if (env.NODE_ENV !== 'production' && NGROK_ORIGIN_REGEX.test(origin)) {
        return cb(null, true);
      }
      logger.warn({ origin }, 'CORS bloqueado');
      return cb(new Error('Origen no permitido por CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600, // cache de preflight 10 min
  }),
);

// ═══════════════════════════════════════════════════
// 3. Compresión (gzip) — CRÍTICO para túneles tipo ngrok
// ═══════════════════════════════════════════════════
// Comprime cualquier respuesta >= 1KB con gzip. JSON típico se reduce 70-85%.
// Saltamos compresión si el cliente envía 'x-no-compression' (debugging) o
// si la respuesta ya es un binario comprimido (PDFs, imágenes, etc.).
app.use(
  compression({
    threshold: 1024,
    level: 6, // balance estándar entre CPU y ratio (1=rápido, 9=máximo)
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  }),
);

// ═══════════════════════════════════════════════════
// 4. Parsers + logging
// ═══════════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(httpLoggerMiddleware);

// Archivos subidos (documentos vehiculares, evidencia, cotizaciones). Contienen
// PII sensible (pólizas, tarjetas de circulación, facturas), por lo que se
// exigen credenciales: authMiddleware ANTES de express.static. El frontend
// accede vía proxy mismo-origen de Next (rewrite /uploads → API), por lo que la
// cookie httpOnly viaja y el render de <img> sigue funcionando.
// Headers de cache largos: cada upload genera un nombre UUID único, inmutable.
app.use(
  '/uploads',
  authMiddleware,
  express.static(path.join(__dirname, '../uploads'), {
    maxAge: '30d',
    immutable: true,
    etag: true,
  }),
);

// ═══════════════════════════════════════════════════
// 4. Healthcheck + documentación OpenAPI (sin auth)
// ═══════════════════════════════════════════════════
app.get('/api/health', healthHandler);
app.use('/api', docsRouter);  // expone /api/docs y /api/docs.json

// ═══════════════════════════════════════════════════
// 5. RUTAS PÚBLICAS
// ═══════════════════════════════════════════════════
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);

// ═══════════════════════════════════════════════════
// 6. RUTAS PROTEGIDAS (JWT)
// ═══════════════════════════════════════════════════
app.use('/api/vehicle-types', authMiddleware, vehicleTypeRouter);
app.use('/api/vehicles', authMiddleware, vehicleImportRouter);
app.use('/api/vehicles', authMiddleware, vehicleRouter);
app.use('/api', authMiddleware, vehicleNoteRouter);
app.use('/api/operators', authMiddleware, operatorRouter);
app.use('/api/stations', authMiddleware, stationRouter);
app.use('/api/workshops', authMiddleware, workshopRouter);
app.use('/api/sectors', authMiddleware, sectorRouter);
app.use('/api', authMiddleware, documentRouter);
app.use('/api/fuel-loads', authMiddleware, fuelLoadRouter);
app.use('/api/dashboard', authMiddleware, dashboardRouter);
app.use('/api/budgets', authMiddleware, budgetRouter);
app.use('/api/service-catalog', authMiddleware, serviceCatalogRouter);
app.use('/api/maintenance', authMiddleware, maintenanceRouter);
app.use('/api/notifications', authMiddleware, notificationRouter);
app.use('/api/reports', authMiddleware, reportRouter);
app.use('/api/audit-logs', authMiddleware, auditLogRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/maintenance-tickets', authMiddleware, maintenanceTicketRouter);
app.use('/api/ticket-quotes', authMiddleware, ticketQuoteRouter);

// ═══════════════════════════════════════════════════
// 7. Sentry error handler (DEBE ir antes del errorHandler propio)
// ═══════════════════════════════════════════════════
// Captura excepciones no manejadas y las envía a Sentry. Es no-op si no hay DSN.
Sentry.setupExpressErrorHandler(app);

// ═══════════════════════════════════════════════════
// 8. Error handler global (DEBE ir al final)
// ═══════════════════════════════════════════════════
app.use(errorHandler);

// ═══════════════════════════════════════════════════
// 8. Graceful shutdown
// ═══════════════════════════════════════════════════
const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API arriba');
  await initializeJobs();
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Apagado solicitado, cerrando…');
  server.close(() => {
    logger.info('Servidor HTTP cerrado');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forzando salida tras 10s sin cerrar');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandledRejection');
});

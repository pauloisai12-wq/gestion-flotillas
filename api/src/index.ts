// /api/src/index.ts
// Punto de entrada API v2 — hardened
// Carga env validado primero (puede abortar si faltan vars críticas)

import { env } from './config/env';

// Sentry DEBE inicializarse antes que express y el resto de módulos —
// se importa solo por su efecto secundario (Sentry.init()).
import './lib/sentry';
import * as Sentry from '@sentry/node';

import express, { Request, Response, NextFunction } from 'express';
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
import qaExternaRouter from './routes/qaExternaRouter';
import qaExternaRegistrosRouter from './routes/qaExternaRegistrosRouter';
import qaExternaPersonasRouter from './routes/qaExternaPersonasRouter';
import encuestasIngestRouter from './routes/encuestasIngestRouter';
import encuestasRevisionRouter from './routes/encuestasRevisionRouter';

import { initializeJobs, shutdownJobs } from './jobs';
import prisma from './lib/prisma';
import { closeRedis } from './lib/redis';
import { authMiddleware } from './middlewares/authMiddleware';
import { deviceAuthMiddleware } from './middlewares/deviceAuthMiddleware';
import { encuestasDeviceAuthMiddleware } from './middlewares/encuestasDeviceAuthMiddleware';
import { getClientIp, rateLimit } from './middlewares/rateLimit';
import { RoleGroups } from './middlewares/roleMiddleware';
import { ensureQaExternaDir } from './lib/qaExternaStorage';
import { errorHandler } from './middlewares/errorHandler';
import { logger, httpLoggerMiddleware } from './lib/logger';
import { healthHandler } from './lib/health';
import { ensureUploadDirectories } from './lib/uploadStorage';

const app = express();

// ═══════════════════════════════════════════════════
// 0. Trust proxy — detrás de Caddy/Next, req.ip debe reflejar la IP real del
//    cliente (X-Forwarded-For) o rate-limit, CSRF-por-IP y el remoteip de
//    Turnstile colapsan a la IP interna del proxy. Configurable por TRUST_PROXY
//    (nº de saltos); nunca 'true' por defecto (permitiría spoofing de XFF).
// ═══════════════════════════════════════════════════
const trustProxy = env.TRUST_PROXY.trim();
if (trustProxy === 'true') app.set('trust proxy', true);
else if (trustProxy === 'false' || trustProxy === '') app.set('trust proxy', false);
else if (/^\d+$/.test(trustProxy)) app.set('trust proxy', Number(trustProxy));
else app.set('trust proxy', trustProxy.split(',').map((s) => s.trim()));

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
// La ingesta de encuestas acota su cuerpo a 256 KB (los payloads legítimos
// pesan ~2-4 KB). DEBE ir ANTES del parser global: body-parser marca `req._body`
// al terminar, y el de 2 MB se salta cualquier request ya parseado. Así el
// exceso corta el stream con un 413 real —también con Transfer-Encoding
// chunked, donde no hay Content-Length que mirar— en vez de acumular 2 MB por
// petición en un contenedor que comparte hardware con el SAS.
app.use('/api/v1/encuestas', express.json({ limit: '256kb' }));
app.use(express.json({ limit: '2mb' }));
app.use(httpLoggerMiddleware);

// Evidencias y cotizaciones de tickets nunca se sirven por ruta estática: cada
// descarga pasa por el endpoint del recurso, que valida ownership/participación.
app.use(
  '/uploads/maintenance-tickets',
  authMiddleware,
  (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Archivo no encontrado', code: 'NOT_FOUND' });
  },
);

// Los demás archivos subidos contienen PII sensible (pólizas, tarjetas de
// circulación, facturas), por lo que se
// exigen credenciales: authMiddleware ANTES de express.static. El frontend
// accede vía proxy mismo-origen de Next (rewrite /uploads → API), por lo que la
// cookie httpOnly viaja y el render de <img> sigue funcionando.
// Caché privado y separado por cookie: evita que una sesión reutilice la
// evidencia autenticada de otra y fuerza revalidación periódica.
app.use(
  '/uploads',
  authMiddleware,
  // Los archivos estáticos conservan la misma frontera de rol que sus APIs.
  // Normalizar tras decodificar evita saltarse el prefijo con %2f, %2e o "..".
  (req: Request, res: Response, next: NextFunction) => {
    let uploadCategory: string;
    try {
      const decodedPath = decodeURIComponent(req.path).replace(/\\/g, '/');
      uploadCategory = path.posix.normalize(`/${decodedPath}`).split('/')[1] ?? '';
    } catch {
      res.status(400).json({ error: 'Ruta de archivo inválida', code: 'BAD_REQUEST' });
      return;
    }

    // Defensa adicional para variantes codificadas que no coincidan con el
    // mount explícito anterior: jamás llegan a express.static.
    if (uploadCategory === 'maintenance-tickets') {
      res.status(404).json({ error: 'Archivo no encontrado', code: 'NOT_FOUND' });
      return;
    }

    const scopedRoles =
      uploadCategory === 'maintenance'
        ? RoleGroups.MAINTENANCE_READERS
        : uploadCategory === 'documents'
          ? RoleGroups.VEHICLE_READERS
          : null;

    if (
      req.user?.role === 'REVISOR_QA' ||
      (scopedRoles != null && !scopedRoles.includes(req.user!.role))
    ) {
      res.status(403).json({ error: 'Sin permisos', code: 'FORBIDDEN' });
      return;
    }
    next();
  },
  express.static(path.join(__dirname, '../uploads'), {
    maxAge: '1h',
    immutable: false,
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');
      res.setHeader('Vary', 'Cookie');
    },
  }),
);

// ═══════════════════════════════════════════════════
// 4. Healthcheck + documentación OpenAPI (sin auth)
// ═══════════════════════════════════════════════════
app.get('/api/health', healthHandler);
// Documentación OpenAPI: solo fuera de producción. En prod (ngrok/internet) no
// publicamos el mapa completo de endpoints/schemas (reconocimiento de ataque).
if (env.NODE_ENV !== 'production') {
  app.use('/api', docsRouter); // expone /api/docs y /api/docs.json
}

// ═══════════════════════════════════════════════════
// 5. RUTAS PÚBLICAS
// ═══════════════════════════════════════════════════
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);

// ═══════════════════════════════════════════════════
// 5.bis RUTA DE DISPOSITIVO (qa_externa) — auth por API key, NO JWT
// ═══════════════════════════════════════════════════
// DEBE ir ANTES de las rutas protegidas: abajo hay routers montados con comodín
// en '/api' (vehicleNoteRouter, documentRouter) cuyo authMiddleware (JWT) atrapa
// CUALQUIER /api/*, incluido /api/qa-externa/*, y devolvería 401 (token JWT
// inválido) antes de llegar al guard de dispositivo. Rate-limit por IP
// (pre-auth, fail-open) para frenar sondeo de keys + guard que envuelve el router.
//
// Este cubo NO es cuota de captura: es anti-sondeo de API keys y corre antes de
// autenticar, así que no puede distinguir /ingest de /personas. De ahí sus dos
// particularidades:
//   · cuota propia (QA_EXTERNA_IP_RATE_MAX = 2 × QA_EXTERNA_RATE_MAX), para que
//     una captura no agote el presupuesto de la otra al vaciarse las dos colas
//     del teléfono en el mismo minuto;
//   · clave propia (`rl:qae:ip:<ip>`) en vez del `rl:ip:<ip>` por defecto, que
//     comparte contador con publicRouter (max 10): sin prefijo propio, el tráfico
//     de GeoCampo consumía el cubo del portal público y viceversa.
app.use(
  '/api/qa-externa',
  rateLimit({
    max: env.QA_EXTERNA_IP_RATE_MAX,
    windowSec: env.QA_EXTERNA_RATE_WINDOW_SEC,
    keyBuilder: (req) => `qae:ip:${getClientIp(req)}`,
  }),
  deviceAuthMiddleware,
  qaExternaRouter,
);

// ═══════════════════════════════════════════════════
// 5.ter RUTA DE DISPOSITIVO (encuestas Okrean) — auth por API key, NO JWT
// ═══════════════════════════════════════════════════
// Mismo razonamiento que el bloque 5.bis de qa_externa: va ANTES de las rutas
// protegidas porque los comodines `app.use('/api', authMiddleware, …)` de abajo
// atrapan CUALQUIER /api/* y devolverían 401 antes del guard de dispositivo; y
// lleva cubo de rate-limit por IP propio (`rl:enc:ip:<ip>`, pre-auth,
// fail-open) para no compartir contador con el portal público ni con GeoCampo.
// El padrón de dispositivos es independiente del de qa_externa (tabla y pepper
// propios), así que también lo es el guard.
app.use(
  '/api/v1/encuestas',
  rateLimit({
    max: env.ENCUESTAS_IP_RATE_MAX,
    windowSec: env.ENCUESTAS_RATE_WINDOW_SEC,
    keyBuilder: (req) => `enc:ip:${getClientIp(req)}`,
  }),
  encuestasDeviceAuthMiddleware,
  encuestasIngestRouter,
);

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
// Lado REVISOR_QA: listado + export ZIP de evidencia qa_externa. Va bajo
// /api/qa-externa-registros (NO /api/qa-externa/*, que es del router de ingesta
// con guard por API key montado más arriba).
app.use('/api/qa-externa-registros', authMiddleware, qaExternaRegistrosRouter);
// Segunda captura de GeoCampo (registro de personas, sin foto): listado + CSV
// para el mismo revisor. Mismo motivo que arriba para vivir fuera de
// /api/qa-externa/*, que es el montaje de ingesta por API key.
app.use('/api/qa-externa-personas', authMiddleware, qaExternaPersonasRouter);
// Lado REVISOR_QA de Encuestas Okrean (listado + CSV), con JWT. Vive fuera de
// /api/v1/encuestas/*, que es el montaje de INGESTA con guard por API key: son
// dos audiencias distintas (teléfono vs. navegador) y no deben compartir ni
// auth ni rate-limit.
app.use('/api/encuestas', authMiddleware, encuestasRevisionRouter);

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
try {
  ensureUploadDirectories();
} catch (err) {
  logger.fatal({ err }, 'No se pudo preparar el almacenamiento de uploads');
  process.exit(1);
}

const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API arriba');
  // Best-effort: que el directorio de qa_externa no se pueda crear (p. ej. el
  // volumen de uploads aún sin permisos de escritura) NO debe tumbar el API.
  // Se reintenta perezosamente en processImage al primer upload.
  try {
    await ensureQaExternaDir();
  } catch (err) {
    logger.error({ err }, 'No se pudo crear el directorio de qa_externa al arranque; se reintentará en el primer upload');
  }
  await initializeJobs();
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Apagado solicitado, cerrando…');

  // Si el cierre ordenado se cuelga, forzar salida (no bloquear el redeploy).
  const forceTimer = setTimeout(() => {
    logger.error('Forzando salida tras 30s sin cerrar');
    process.exit(1);
  }, 30_000);
  forceTimer.unref();

  // 1. Dejar de aceptar nuevas conexiones HTTP.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  logger.info('Servidor HTTP cerrado');

  // 2. Cerrar workers/colas BullMQ, luego Prisma y Redis (en ese orden).
  try {
    await shutdownJobs();
  } catch (err) {
    logger.error({ err }, 'Error cerrando jobs BullMQ');
  }
  try {
    await prisma.$disconnect();
    logger.info('Prisma desconectado');
  } catch (err) {
    logger.error({ err }, 'Error desconectando Prisma');
  }
  await closeRedis();

  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandledRejection');
  void shutdown('unhandledRejection');
});

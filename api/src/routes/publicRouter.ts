// /api/src/routes/publicRouter.ts
// Portal público para operadores — SIN auth, con protecciones:
//   - Rate limit por IP (Redis)
//   - CSRF tokens en Redis (sobreviven restart, escalan horizontalmente)
//   - (Opcional) Cloudflare Turnstile en producción

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { publicFuelLoadSchema } from '../validators/fuelLoadValidator';
import * as fuelLoadService from '../services/fuelLoadService';
import prisma from '../lib/prisma';
import { getRedis } from '../lib/redis';
import { rateLimit, getClientIp } from '../middlewares/rateLimit';
import { BadRequest, NotFound, Forbidden } from '../middlewares/errorHandler';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import { runWithAuditContext } from '../lib/auditContext';

const router = Router();

// Rate limit estándar para todo el portal
const publicRateLimit = rateLimit({
  max: env.RATE_LIMIT_PUBLIC_MAX,
  windowSec: env.RATE_LIMIT_PUBLIC_WINDOW_SEC,
});

router.use(publicRateLimit);

// ─────────────────────────────────────────────
// CSRF tokens en Redis (TTL 10 min, one-use)
// ─────────────────────────────────────────────
const CSRF_TTL_SEC = 600;

async function issueCsrfToken(ip: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex');
  await getRedis().set(`csrf:${token}`, ip, 'EX', CSRF_TTL_SEC);
  return token;
}

async function consumeCsrfToken(token: string, ip: string): Promise<boolean> {
  const stored = await getRedis().getdel(`csrf:${token}`);
  if (!stored) return false;
  // Verificar que la IP que consume sea la misma que emitió
  return stored === ip;
}

// ─────────────────────────────────────────────
// Verificación de Cloudflare Turnstile (opcional)
// ─────────────────────────────────────────────
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    // Sin secret solo se bypasea en development local. En staging o
    // production el portal es público en internet: si falta el secret
    // (por config olvidada), fallamos cerrado en vez de abrir la puerta.
    if (env.NODE_ENV === 'development') return true;
    logger.error(
      { nodeEnv: env.NODE_ENV },
      'Turnstile sin TURNSTILE_SECRET fuera de development: rechazando submit',
    );
    return false;
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'Turnstile verify failed');
    return false;
  }
}

// ═══════════════════════════════════════════════════
// GET /session-token — emite CSRF
// ═══════════════════════════════════════════════════
router.get('/session-token', async (req, res, next) => {
  try {
    const token = await issueCsrfToken(getClientIp(req));
    res.json({ csrfToken: token, expiresInSeconds: CSRF_TTL_SEC });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════
// GET /stations — lista de gasolineras activas
// ═══════════════════════════════════════════════════
router.get('/stations', async (_req, res, next) => {
  try {
    const stations = await prisma.approvedStation.findMany({
      where: { isActive: true },
      select: { id: true, legalName: true, tradeName: true },
      orderBy: { legalName: 'asc' },
    });
    res.json({ data: stations });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════
// GET /verify — valida operador + vehículo + retorna presupuesto
// ═══════════════════════════════════════════════════
router.get('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNumber = String(req.query.employeeNumber ?? '').trim();
    const economicNumber = String(req.query.economicNumber ?? '').trim();

    if (!employeeNumber || !economicNumber) {
      throw BadRequest('employeeNumber y economicNumber son obligatorios');
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { economicNumber },
      select: {
        id: true, plate: true, economicNumber: true, status: true, isActive: true,
        blockReason: true, classification: true,
        vehicleType: { select: { name: true } },
      },
    });

    if (!vehicle) throw NotFound('Número económico');
    if (!vehicle.isActive) throw BadRequest('Vehículo dado de baja');
    if (vehicle.status === 'BLOCKED') {
      throw BadRequest(vehicle.blockReason || 'Vehículo bloqueado por documentos vencidos');
    }

    const operator = await prisma.operator.findUnique({
      where: { employeeNumber },
      select: { id: true, fullName: true, isActive: true },
    });

    if (operator && !operator.isActive) throw BadRequest('Operador dado de baja');

    const now = new Date();
    const budget = await prisma.vehicleBudget.findUnique({
      where: {
        vehicleId_kind_year_month: {
          vehicleId: vehicle.id,
          kind: 'FUEL',
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      },
    });

    const available = budget
      ? Number(budget.baseAmount) + Number(budget.rolloverIn) - Number(budget.spentAmount)
      : null;

    res.json({
      vehicle: {
        id: vehicle.id,
        plate: vehicle.plate,
        economicNumber: vehicle.economicNumber,
        classification: vehicle.classification,
        type: vehicle.vehicleType.name,
      },
      operator: operator ? { fullName: operator.fullName } : null,
      budget: budget
        ? {
            base: Number(budget.baseAmount),
            rollover: Number(budget.rolloverIn),
            spent: Number(budget.spentAmount),
            available,
            cutOff: budget.isCutOff,
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════
// POST /fuel-loads — registro público de carga
// ═══════════════════════════════════════════════════
router.post('/fuel-loads', async (req: Request, res: Response, next: NextFunction) => {
  const ip = getClientIp(req);
  // Contexto de auditoría: el portal es anónimo (sin userId), así que la IP y el
  // userAgent son el único rastro forense. Se propaga vía AsyncLocalStorage para
  // que la extensión de auditoría de Prisma lo registre en el AuditLog del FuelLoad.
  await runWithAuditContext(
    {
      ipAddress: ip,
      userAgent: req.headers['user-agent']?.toString(),
      requestId: res.getHeader('x-request-id') as string | undefined,
    },
    async () => {
  try {
    const parsed = publicFuelLoadSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(BadRequest('Datos inválidos', parsed.error.issues));
    }

    // 1. CSRF check
    const okCsrf = await consumeCsrfToken(parsed.data.csrfToken, ip);
    if (!okCsrf) throw Forbidden('Token expirado o inválido. Refresca la página.');

    // 2. Turnstile check (si está configurado)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turnstileToken = (req.body as any).turnstileToken as string | undefined;
    if (env.TURNSTILE_SECRET) {
      if (!turnstileToken) throw BadRequest('Captcha requerido');
      const ok = await verifyTurnstile(turnstileToken, ip);
      if (!ok) throw Forbidden('Captcha inválido');
    }

    // 3. Crear carga
    try {
      const result = await fuelLoadService.createPublicFuelLoad(parsed.data);
      res.status(201).json({ data: result, message: 'Carga registrada, pendiente de revisión' });
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = error as any;
      if (e.code === 'BUDGET_EXCEEDED') {
        return res.status(402).json({
          error: 'Sin presupuesto disponible',
          code: 'BUDGET_EXCEEDED',
          available: e.available,
          message: e.message,
        });
      }
      throw error;
    }
  } catch (e) {
    next(e);
  }
    },
  );
});

export default router;

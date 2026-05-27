// /api/src/routes/adminRouter.ts
// Operaciones administrativas críticas — auditadas + doble confirmación

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod/v4';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { BadRequest, Forbidden } from '../middlewares/errorHandler';
import { logger } from '../lib/logger';

const router = Router();

// ═══════════════════════════════════════════════════
// POST /admin/wipe-operational
// Borra todos los datos operativos manteniendo usuarios.
// EXIGE escribir literal: "BORRAR TODO" + email del admin
// ═══════════════════════════════════════════════════
const wipeSchema = z.object({
  confirmation: z.literal('BORRAR TODO', { message: 'Escribe exactamente: BORRAR TODO' }),
  adminEmail: z.string().email('Correo del admin requerido'),
});

router.post(
  '/wipe-operational',
  requireRole(RoleGroups.ADMIN_ONLY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = wipeSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(BadRequest('Confirmación inválida', parsed.error.issues));
      }

      const userId = req.user!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });

      // El email del admin que confirma debe coincidir con el del usuario logueado
      if (!user || user.email !== parsed.data.adminEmail.toLowerCase()) {
        return next(Forbidden('El correo de confirmación no coincide con tu cuenta'));
      }

      logger.warn({ userId, email: user.email }, '⚠️ WIPE OPERATIONAL iniciado');

      const counts: Record<string, number> = {};
      const steps: [string, () => Promise<{ count: number }>][] = [
        ['notifications', () => prisma.notification.deleteMany({})],
        ['vehicle_notes', () => prisma.vehicleNote.deleteMany({})],
        ['fuel_loads', () => prisma.fuelLoad.deleteMany({})],
        ['maintenance_records', () => prisma.maintenanceRecord.deleteMany({})],
        ['vehicle_assignments', () => prisma.vehicleAssignment.deleteMany({})],
        ['documents', () => prisma.document.deleteMany({})],
        ['vehicle_budgets', () => prisma.vehicleBudget.deleteMany({})],
        ['monthly_budgets', () => prisma.monthlyBudget.deleteMany({})],
        ['report_history', () => prisma.reportHistory.deleteMany({})],
        ['vehicles', () => prisma.vehicle.deleteMany({})],
        ['operators', () => prisma.operator.deleteMany({})],
        ['approved_stations', () => prisma.approvedStation.deleteMany({})],
        ['workshops', () => prisma.workshop.deleteMany({})],
        ['service_catalog', () => prisma.serviceCatalog.deleteMany({})],
        ['sectors', () => prisma.sector.deleteMany({})],
        ['vehicle_types', () => prisma.vehicleType.deleteMany({})],
      ];

      for (const [name, fn] of steps) {
        const r = await fn();
        counts[name] = r.count;
      }

      // Registro explícito en AuditLog (además del automático)
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'WIPE',
          resource: 'OperationalData',
          metadata: counts,
          ipAddress: (req.ip || '').toString(),
        },
      });

      logger.warn({ counts, userId }, '⚠️ WIPE OPERATIONAL completado');
      res.json({ data: { deleted: counts, preservedUsers: await prisma.user.count() } });
    } catch (e) {
      next(e);
    }
  },
);

// ═══════════════════════════════════════════════════
// GET /admin/stats — métricas del sistema para admin
// ═══════════════════════════════════════════════════
router.get('/stats', requireRole(RoleGroups.ADMIN_ONLY), async (_req, res, next) => {
  try {
    const [users, vehicles, operators, fuelLoads, auditLogs] = await Promise.all([
      prisma.user.count(),
      prisma.vehicle.count(),
      prisma.operator.count(),
      prisma.fuelLoad.count(),
      prisma.auditLog.count(),
    ]);
    res.json({ data: { users, vehicles, operators, fuelLoads, auditLogs } });
  } catch (e) {
    next(e);
  }
});

export default router;

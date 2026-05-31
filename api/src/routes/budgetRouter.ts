// /api/src/routes/budgetRouter.ts
// Presupuestos v2 — unificados FUEL|MAINTENANCE con rollover mensual
// Reemplaza completamente el router v1.

import { Router, Request, Response } from 'express';
import { BudgetKind, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups, Roles } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import {
  assignBudgetSchema,
  distributeBudgetSchema,
  closeMonthSchema,
  listBudgetsQuerySchema,
} from '../validators/budgetValidator';
import { closeMonthAndRollover } from '../services/budgetService';
import { BadRequest, Forbidden } from '../middlewares/errorHandler';

const router = Router();

/** Autorización por kind (FUEL/MAINTENANCE) — centraliza el check antes
 *  duplicado inline en /assign, /distribute y PUT /monthly-pool. */
function assertCanManageKind(role: string, kind: BudgetKind): void {
  const allowed = kind === 'FUEL' ? [Roles.ADMIN, Roles.SUP_FUEL] : [Roles.ADMIN, Roles.SUP_MAINT];
  if (!allowed.includes(role as never)) {
    throw Forbidden(
      kind === 'FUEL'
        ? 'Solo admin o supervisor de combustible pueden gestionar este presupuesto'
        : 'Solo admin o supervisor de mantenimiento pueden gestionar este presupuesto',
    );
  }
}

/** GET / — lista presupuestos con filtros (kind, year, month, vehicleId) */
router.get('/', requireRole(RoleGroups.ANY_AUTH), ah(async (req: Request, res: Response) => {
  const parsed = listBudgetsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Query inválida', issues: parsed.error.issues });
  }
  const { kind, year, month, vehicleId } = parsed.data;

  const user = req.user!;

  // Restricción por rol
  let kindFilter: BudgetKind | undefined = kind;
  if (user.role === Roles.SUP_FUEL) kindFilter = 'FUEL';
  else if (user.role === Roles.SUP_MAINT) kindFilter = 'MAINTENANCE';
  else if (user.role === Roles.SUP_VEHICLES) {
    return res.status(403).json({ error: 'Sin acceso a presupuestos' });
  }

  const where: Prisma.VehicleBudgetWhereInput = {
    ...(kindFilter ? { kind: kindFilter } : {}),
    ...(year ? { year } : {}),
    ...(month ? { month } : {}),
    ...(vehicleId ? { vehicleId } : {}),
  };

  const budgets = await prisma.vehicleBudget.findMany({
    where,
    include: {
      vehicle: { select: { id: true, plate: true, economicNumber: true, classification: true } },
      creator: { select: { id: true, fullName: true } },
      editor: { select: { id: true, fullName: true } },
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { vehicleId: 'asc' }],
    take: 2000, // tope de seguridad: el listado crece cada mes; no cargar todo el histórico sin límite
  });

  const serialized = budgets.map((b) => ({
    ...b,
    baseAmount: Number(b.baseAmount),
    rolloverIn: Number(b.rolloverIn),
    spentAmount: Number(b.spentAmount),
    available: Number(b.baseAmount) + Number(b.rolloverIn) - Number(b.spentAmount),
  }));

  res.json({ data: serialized });
}));

/** POST /assign — asignar baseAmount a UN vehículo en un periodo.
 *  requireRole(BUDGET_MANAGERS) como primera barrera; el check por kind afina luego. */
router.post('/assign', requireRole(RoleGroups.BUDGET_MANAGERS), ah(async (req: Request, res: Response) => {
  const parsed = assignBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
  }
  const { vehicleId, kind, year, month, baseAmount } = parsed.data;

  const user = req.user!;

  assertCanManageKind(user.role, kind);

  // Pre-check (UX): mensaje detallado para el caso común.
  const pool = await prisma.monthlyBudget.findUnique({
    where: { kind_year_month: { kind, year, month } },
  });
  if (pool) {
    const agg = await prisma.vehicleBudget.aggregate({
      where: { kind, year, month, NOT: { vehicleId } },
      _sum: { baseAmount: true },
    });
    const othersSum = Number(agg._sum.baseAmount ?? 0);
    const newTotal = othersSum + baseAmount;
    const poolAmount = Number(pool.totalAmount);
    if (newTotal > poolAmount) {
      return res.status(400).json({
        error: 'Excede el pote mensual',
        message: `La suma asignada ($${newTotal.toLocaleString('es-MX')}) excede el pote del mes ($${poolAmount.toLocaleString('es-MX')}). Sin asignar: $${(poolAmount - othersSum).toLocaleString('es-MX')}.`,
      });
    }
  }

  // Escritura con guard de concurrencia: lockeamos el pote del periodo (FOR UPDATE)
  // y re-validamos DENTRO de la tx, para que dos asignaciones simultáneas al mismo
  // pote no lo excedan (el pre-check de arriba puede ver datos obsoletos bajo carrera).
  const budget = await prisma.$transaction(async (tx) => {
    const poolRows = await tx.$queryRaw<Array<{ totalAmount: string }>>`
      SELECT "totalAmount"::text FROM monthly_budgets
      WHERE kind = ${kind}::"BudgetKind" AND year = ${year} AND month = ${month}
      FOR UPDATE
    `;
    if (poolRows.length > 0) {
      const agg = await tx.vehicleBudget.aggregate({
        where: { kind, year, month, NOT: { vehicleId } },
        _sum: { baseAmount: true },
      });
      const newTotal = Number(agg._sum.baseAmount ?? 0) + baseAmount;
      if (newTotal > Number(poolRows[0].totalAmount)) {
        throw BadRequest('Excede el pote mensual (otra asignación concurrente consumió el saldo). Refresca e intenta de nuevo.');
      }
    }
    return tx.vehicleBudget.upsert({
      where: { vehicleId_kind_year_month: { vehicleId, kind, year, month } },
      create: { vehicleId, kind, year, month, baseAmount, createdBy: user.userId, updatedBy: user.userId },
      update: { baseAmount, updatedBy: user.userId },
    });
  });

  res.json({
    data: {
      ...budget,
      baseAmount: Number(budget.baseAmount),
      rolloverIn: Number(budget.rolloverIn),
      spentAmount: Number(budget.spentAmount),
    },
  });
}));

/** POST /distribute — asignación masiva (valida contra pote) */
router.post('/distribute', requireRole(RoleGroups.BUDGET_MANAGERS), ah(async (req: Request, res: Response) => {
  const parsed = distributeBudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
  }
  const { kind, year, month, distributions } = parsed.data;
  const user = req.user!;

  assertCanManageKind(user.role, kind);

  const userId = user.userId;
  const targetIds = distributions.map((d) => d.vehicleId);
  const distSum = distributions.reduce((s, d) => s + d.baseAmount, 0);

  // Pre-check (UX): mensaje detallado para el caso común.
  const pool = await prisma.monthlyBudget.findUnique({
    where: { kind_year_month: { kind, year, month } },
  });
  if (pool) {
    const agg = await prisma.vehicleBudget.aggregate({
      where: { kind, year, month, NOT: { vehicleId: { in: targetIds } } },
      _sum: { baseAmount: true },
    });
    const othersSum = Number(agg._sum.baseAmount ?? 0);
    const newTotal = othersSum + distSum;
    const poolAmount = Number(pool.totalAmount);
    if (newTotal > poolAmount) {
      return res.status(400).json({
        error: 'Excede el pote mensual',
        message: `La asignación masiva ($${newTotal.toLocaleString('es-MX')}) excede el pote del mes ($${poolAmount.toLocaleString('es-MX')}).`,
      });
    }
  }

  // Escritura con guard de concurrencia: lock del pote + re-validación dentro de
  // la tx (igual que /assign), para que distribuciones concurrentes no lo excedan.
  const count = await prisma.$transaction(async (tx) => {
    const poolRows = await tx.$queryRaw<Array<{ totalAmount: string }>>`
      SELECT "totalAmount"::text FROM monthly_budgets
      WHERE kind = ${kind}::"BudgetKind" AND year = ${year} AND month = ${month}
      FOR UPDATE
    `;
    if (poolRows.length > 0) {
      const agg = await tx.vehicleBudget.aggregate({
        where: { kind, year, month, NOT: { vehicleId: { in: targetIds } } },
        _sum: { baseAmount: true },
      });
      if (Number(agg._sum.baseAmount ?? 0) + distSum > Number(poolRows[0].totalAmount)) {
        throw BadRequest('Excede el pote mensual (asignación concurrente). Refresca e intenta de nuevo.');
      }
    }
    let n = 0;
    for (const d of distributions) {
      await tx.vehicleBudget.upsert({
        where: { vehicleId_kind_year_month: { vehicleId: d.vehicleId, kind, year, month } },
        create: {
          vehicleId: d.vehicleId, kind, year, month,
          baseAmount: d.baseAmount, createdBy: userId, updatedBy: userId,
        },
        update: { baseAmount: d.baseAmount, updatedBy: userId },
      });
      n++;
    }
    return n;
  });

  res.json({ data: { count } });
}));

/** POST /close-month — cerrar mes + rollover idempotente (admin) */
router.post('/close-month', requireRole(RoleGroups.ADMIN_ONLY), ah(async (req: Request, res: Response) => {
  const parsed = closeMonthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues });
  }
  const result = await closeMonthAndRollover(parsed.data);
  res.json({ data: result });
}));

// ─────────────────────────────────────────────
// POTE MENSUAL TOTAL (MonthlyBudget)
// ─────────────────────────────────────────────

/** GET /monthly-pool — pote declarado + suma asignada + resumen */
router.get('/monthly-pool', requireRole(RoleGroups.ANY_AUTH), ah(async (req: Request, res: Response) => {
  const kind = (req.query.kind as BudgetKind) || 'FUEL';
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;

  const user = req.user!;
  if (kind === 'FUEL' && user.role === Roles.SUP_MAINT) {
    return res.status(403).json({ error: 'Sin acceso' });
  }
  if (kind === 'MAINTENANCE' && user.role === Roles.SUP_FUEL) {
    return res.status(403).json({ error: 'Sin acceso' });
  }

  const pool = await prisma.monthlyBudget.findUnique({
    where: { kind_year_month: { kind, year, month } },
  });

  // Suma asignada a vehículos en ese periodo
  const agg = await prisma.vehicleBudget.aggregate({
    where: { kind, year, month },
    _sum: { baseAmount: true, rolloverIn: true, spentAmount: true },
    _count: true,
  });

  const totalPool = pool ? Number(pool.totalAmount) : 0;
  const assigned = Number(agg._sum.baseAmount ?? 0);
  const rollover = Number(agg._sum.rolloverIn ?? 0);
  const spent = Number(agg._sum.spentAmount ?? 0);
  const unassigned = Math.max(0, totalPool - assigned);
  const pctAssigned = totalPool > 0 ? Math.round((assigned / totalPool) * 100) : 0;

  res.json({
    data: {
      kind, year, month,
      totalPool,
      assigned,
      rollover,
      spent,
      unassigned,
      pctAssigned,
      unitsCount: agg._count ?? 0,
      notes: pool?.notes ?? null,
      hasPool: !!pool,
    },
  });
}));

/** PUT /monthly-pool — declarar/actualizar el pote total del mes */
router.put('/monthly-pool', requireRole(RoleGroups.BUDGET_MANAGERS), ah(async (req: Request, res: Response) => {
  const schema = {
    kind: req.body.kind,
    year: Number(req.body.year),
    month: Number(req.body.month),
    totalAmount: Number(req.body.totalAmount),
    notes: req.body.notes || null,
  };

  if (!['FUEL', 'MAINTENANCE'].includes(schema.kind)) {
    return res.status(400).json({ error: 'kind debe ser FUEL o MAINTENANCE' });
  }
  if (!Number.isFinite(schema.totalAmount) || schema.totalAmount < 0) {
    return res.status(400).json({ error: 'totalAmount debe ser número >= 0' });
  }

  const user = req.user!;
  assertCanManageKind(user.role, schema.kind as BudgetKind);

  const pool = await prisma.monthlyBudget.upsert({
    where: { kind_year_month: { kind: schema.kind, year: schema.year, month: schema.month } },
    create: {
      kind: schema.kind, year: schema.year, month: schema.month,
      totalAmount: schema.totalAmount, notes: schema.notes,
      createdBy: user.userId, updatedBy: user.userId,
    },
    update: {
      totalAmount: schema.totalAmount, notes: schema.notes, updatedBy: user.userId,
    },
  });

  res.json({ data: { ...pool, totalAmount: Number(pool.totalAmount) } });
}));

export default router;

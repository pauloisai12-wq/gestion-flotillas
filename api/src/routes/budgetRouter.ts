// Presupuestos v2 — unificados FUEL|MAINTENANCE con rollover mensual

import { Router, Request, Response } from 'express';
import { z } from 'zod/v4';
import { BudgetKind, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireRole, RoleGroups, Roles } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { validateBody, validateQuery } from '../middlewares/validate';
import {
  assignBudgetSchema,
  distributeBudgetSchema,
  closeMonthSchema,
  monthlyPoolSchema,
  listBudgetsQuerySchema,
  distributeTargetBudgetSchema,
  distributionTargetsQuerySchema,
  AssignBudgetInput,
  DistributeBudgetInput,
  CloseMonthInput,
  MonthlyPoolInput,
  DistributeTargetBudgetInput,
  DistributionTargetsQuery,
} from '../validators/budgetValidator';
import { closeMonthAndRollover } from '../services/budgetService';
import {
  assignBudgetToVehicle,
  decimalTextToCents,
  distributeExplicitBudgets,
  distributeBudgetToTarget,
  getDistributionTargetCounts,
  lockMonthlyPoolCents,
  moneyAmountToCents,
} from '../services/budgetDistributionService';
import { BadRequest, Forbidden } from '../middlewares/errorHandler';
import { lockOpenBudgetPeriod } from '../services/budgetPeriodLock';
import { businessPeriodForDate } from '../lib/businessTime';

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
router.get('/', requireRole(RoleGroups.BUDGET_READERS), validateQuery(listBudgetsQuerySchema), ah(async (req: Request, res: Response) => {
  const { kind, year, month, vehicleId, search, page, limit } = req.query as unknown as z.infer<typeof listBudgetsQuerySchema>;

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
    ...(search
      ? {
          vehicle: {
            OR: [
              { economicNumber: { contains: search, mode: 'insensitive' as const } },
              { plate: { contains: search, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };

  const [budgets, total] = await Promise.all([
    prisma.vehicleBudget.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plate: true, economicNumber: true, classification: true } },
        creator: { select: { id: true, fullName: true } },
        editor: { select: { id: true, fullName: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { vehicleId: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.vehicleBudget.count({ where }),
  ]);

  const serialized = budgets.map((b) => ({
    ...b,
    baseAmount: Number(b.baseAmount),
    rolloverIn: Number(b.rolloverIn),
    spentAmount: Number(b.spentAmount),
    available: Number(b.baseAmount) + Number(b.rolloverIn) - Number(b.spentAmount),
  }));

  res.json({
    data: serialized,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

/** POST /assign — asignar baseAmount a UN vehículo en un periodo.
 *  requireRole(BUDGET_MANAGERS) como primera barrera; el check por kind afina luego. */
router.post('/assign', requireRole(RoleGroups.BUDGET_MANAGERS), validateBody(assignBudgetSchema), ah(async (req: Request, res: Response) => {
  const input = req.body as AssignBudgetInput;

  const user = req.user!;

  assertCanManageKind(user.role, input.kind);
  const budget = await assignBudgetToVehicle(input, user.userId);

  res.json({
    data: {
      ...budget,
      baseAmount: Number(budget.baseAmount),
      rolloverIn: Number(budget.rolloverIn),
      spentAmount: Number(budget.spentAmount),
    },
  });
}));

/** GET /distribution-targets — conteos autoritativos, sin paginar vehículos. */
router.get(
  '/distribution-targets',
  requireRole(RoleGroups.BUDGET_READERS),
  validateQuery(distributionTargetsQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { kind, year, month } = req.query as unknown as DistributionTargetsQuery;
    const user = req.user!;
    if (kind === 'FUEL' && user.role === Roles.SUP_MAINT) throw Forbidden('Sin acceso');
    if (kind === 'MAINTENANCE' && user.role === Roles.SUP_FUEL) throw Forbidden('Sin acceso');

    const counts = await getDistributionTargetCounts(kind, year, month);
    res.json({ data: counts });
  }),
);

/**
 * POST /distribute-target — el backend resuelve ALL/UNASSIGNED/CLASSIFICATION
 * y calcula los montos dentro de la misma transacción que escribe.
 */
router.post(
  '/distribute-target',
  requireRole(RoleGroups.BUDGET_MANAGERS),
  validateBody(distributeTargetBudgetSchema),
  ah(async (req: Request, res: Response) => {
    const input = req.body as DistributeTargetBudgetInput;
    const user = req.user!;
    assertCanManageKind(user.role, input.kind);

    const result = await distributeBudgetToTarget(input, user.userId);
    res.json({ data: result });
  }),
);

/** POST /distribute — asignación masiva (valida contra pote) */
router.post('/distribute', requireRole(RoleGroups.BUDGET_MANAGERS), validateBody(distributeBudgetSchema), ah(async (req: Request, res: Response) => {
  const input = req.body as DistributeBudgetInput;
  const user = req.user!;

  assertCanManageKind(user.role, input.kind);
  const result = await distributeExplicitBudgets(input, user.userId);
  res.json({ data: result });
}));

/** POST /close-month — cerrar mes + rollover idempotente (admin) */
router.post('/close-month', requireRole(RoleGroups.ADMIN_ONLY), validateBody(closeMonthSchema), ah(async (req: Request, res: Response) => {
  const result = await closeMonthAndRollover(req.body as CloseMonthInput);
  res.json({ data: result });
}));

// ─────────────────────────────────────────────
// POTE MENSUAL TOTAL (MonthlyBudget)
// ─────────────────────────────────────────────

/** GET /monthly-pool — pote declarado + suma asignada + resumen */
router.get('/monthly-pool', requireRole(RoleGroups.BUDGET_READERS), ah(async (req: Request, res: Response) => {
  const kind = (req.query.kind as BudgetKind) || 'FUEL';
  const currentPeriod = businessPeriodForDate();
  const year = Number(req.query.year) || currentPeriod.year;
  const month = Number(req.query.month) || currentPeriod.month;

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

  // Incluye la porción consumida de unidades dadas de baja. Su saldo disponible
  // ya fue liberado al desactivarlas; omitir toda la fila duplicaría esa
  // liberación y haría que el pote pareciera mayor al dinero realmente restante.
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
router.put('/monthly-pool', requireRole(RoleGroups.BUDGET_MANAGERS), validateBody(monthlyPoolSchema), ah(async (req: Request, res: Response) => {
  const { kind, year, month, totalAmount, notes } = req.body as MonthlyPoolInput;

  const user = req.user!;
  assertCanManageKind(user.role, kind);

  const pool = await prisma.$transaction(async (tx) => {
    await lockOpenBudgetPeriod(tx, kind, year, month);
    await lockMonthlyPoolCents(tx, kind, year, month);

    // Misma regla financiera del GET: el gasto hundido de una baja sigue
    // respaldado por el pote aunque la unidad ya no sea un indicador operativo.
    const aggregate = await tx.vehicleBudget.aggregate({
      where: { kind, year, month },
      _sum: { baseAmount: true },
    });
    const assignedCents = decimalTextToCents(String(aggregate._sum.baseAmount ?? 0));
    const requestedCents = moneyAmountToCents(totalAmount);
    if (requestedCents < assignedCents) {
      throw BadRequest(
        'El pote mensual no puede ser menor que el presupuesto ya asignado a vehículos',
        { assignedAmount: Number(assignedCents) / 100 },
      );
    }

    return tx.monthlyBudget.upsert({
      where: { kind_year_month: { kind, year, month } },
      create: {
        kind, year, month,
        totalAmount: Number(requestedCents) / 100, notes: notes ?? null,
        createdBy: user.userId, updatedBy: user.userId,
      },
      update: {
        totalAmount: Number(requestedCents) / 100, notes: notes ?? null, updatedBy: user.userId,
      },
    });
  });

  res.json({ data: { ...pool, totalAmount: Number(pool.totalAmount) } });
}));

export default router;

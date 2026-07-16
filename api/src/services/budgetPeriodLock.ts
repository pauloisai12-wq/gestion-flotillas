import { BudgetKind } from '@prisma/client';
import { Tx } from '../lib/prisma';
import { Conflict } from '../middlewares/errorHandler';

function budgetTimelineKey(kind: BudgetKind): string {
  return `budget-timeline:${kind}`;
}

/** Mutaciones normales conviven entre sí, pero no con un cierre cronológico. */
export async function lockBudgetTimelineShared(tx: Tx, kind: BudgetKind): Promise<void> {
  const key = budgetTimelineKey(kind);
  await tx.$queryRaw<Array<{ pg_advisory_xact_lock_shared: null }>>`
    SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))
  `;
}

/** El cierre espera a que terminen todas las mutaciones del timeline del tipo. */
export async function lockBudgetTimelineExclusive(tx: Tx, kind: BudgetKind): Promise<void> {
  const key = budgetTimelineKey(kind);
  await tx.$queryRaw<Array<{ pg_advisory_xact_lock: null }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `;
}

/**
 * Lock transaccional común para cualquier mutación del mismo periodo.
 * Funciona incluso cuando todavía no existe MonthlyBudget ni VehicleBudget.
 */
export async function lockBudgetPeriod(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
): Promise<void> {
  const key = `budget-period:${kind}:${year}:${month}`;
  await tx.$queryRaw<Array<{ pg_advisory_xact_lock: null }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
  `;
}

export async function isBudgetPeriodClosed(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
): Promise<boolean> {
  const closed = await tx.$queryRaw<Array<{ closed: number }>>`
    SELECT 1 AS closed
    FROM monthly_budgets
    WHERE kind = ${kind}::"BudgetKind"
      AND year = ${year} AND month = ${month}
      AND "isClosed" = true
    UNION ALL
    SELECT 1 AS closed
    FROM vehicle_budgets
    WHERE kind = ${kind}::"BudgetKind"
      AND year = ${year} AND month = ${month}
      AND "isClosed" = true
    LIMIT 1
  `;
  return closed.length > 0;
}

/** El marcador del pote o una asignación cerrada vuelven inmutable al periodo. */
export async function assertBudgetPeriodOpen(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
): Promise<void> {
  // Un cierre posterior implica que todos sus predecesores debieron cerrarse.
  // Esto evita crear retroactivamente junio después de haber cerrado julio.
  const closedAtOrAfter = await tx.$queryRaw<Array<{ closed: number }>>`
    SELECT 1 AS closed
    FROM monthly_budgets
    WHERE kind = ${kind}::"BudgetKind"
      AND "isClosed" = true
      AND (year > ${year} OR (year = ${year} AND month >= ${month}))
    UNION ALL
    SELECT 1 AS closed
    FROM vehicle_budgets
    WHERE kind = ${kind}::"BudgetKind"
      AND "isClosed" = true
      AND (year > ${year} OR (year = ${year} AND month >= ${month}))
    LIMIT 1
  `;
  if (closedAtOrAfter.length > 0) {
    throw Conflict('El periodo presupuestal está cerrado y ya no admite asignaciones');
  }
}

export async function lockOpenBudgetPeriod(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
): Promise<void> {
  await lockBudgetTimelineShared(tx, kind);
  await lockBudgetPeriod(tx, kind, year, month);
  await assertBudgetPeriodOpen(tx, kind, year, month);
}

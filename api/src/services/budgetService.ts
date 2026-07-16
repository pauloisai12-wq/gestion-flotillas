// /api/src/services/budgetService.ts
// Servicio v2 — lógica transaccional de presupuestos con rollover

import prisma, { type Tx } from '../lib/prisma';
import { BudgetKind, Prisma } from '@prisma/client';
import { CloseMonthInput } from '../validators/budgetValidator';
import { BadRequest, Conflict } from '../middlewares/errorHandler';
import {
  assertBudgetPeriodOpen,
  isBudgetPeriodClosed,
  lockBudgetPeriod,
  lockBudgetTimelineExclusive,
  lockBudgetTimelineShared,
} from './budgetPeriodLock';
import {
  businessPeriodForDate,
  businessPeriodStart,
  type BusinessPeriod,
} from '../lib/businessTime';

export type BudgetPeriod = BusinessPeriod;

/** Retorna { year, month } del mes anterior al dado */
function prevMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/** Retorna { year, month } del mes siguiente */
function nextMonth(year: number, month: number) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function periodStart(year: number, month: number): Date {
  return businessPeriodStart({ year, month });
}

type LockedFuelBudget = {
  id: number;
  baseAmount: string;
  rolloverIn: string;
  spentAmount: string;
  isClosed: boolean;
};

async function lockFuelBudget(
  tx: Tx,
  vehicleId: number,
  period: BudgetPeriod,
): Promise<LockedFuelBudget | null> {
  const rows = await tx.$queryRaw<LockedFuelBudget[]>`
    SELECT id, "baseAmount"::text, "rolloverIn"::text,
           "spentAmount"::text, "isClosed"
    FROM vehicle_budgets
    WHERE "vehicleId" = ${vehicleId}
      AND kind = 'FUEL'::"BudgetKind"
      AND year = ${period.year}
      AND month = ${period.month}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function findEarlierOpenBudgetPeriod(
  tx: Tx,
  kind: BudgetKind,
  period: BudgetPeriod,
): Promise<BudgetPeriod | null> {
  const rows = await tx.$queryRaw<BudgetPeriod[]>`
    SELECT open_period.year, open_period.month
    FROM (
      SELECT year, month
      FROM monthly_budgets
      WHERE kind = ${kind}::"BudgetKind" AND "isClosed" = false
      UNION
      SELECT year, month
      FROM vehicle_budgets
      WHERE kind = ${kind}::"BudgetKind" AND "isClosed" = false
    ) AS open_period
    WHERE open_period.year < ${period.year}
       OR (open_period.year = ${period.year} AND open_period.month < ${period.month})
    ORDER BY open_period.year, open_period.month
    LIMIT 1
  `;
  let earliest = rows[0] ?? null;
  if (kind === 'FUEL') {
    const pending = await tx.fuelLoad.findFirst({
      where: {
        status: 'PENDING_REVIEW',
        loadDate: { lt: periodStart(period.year, period.month) },
      },
      orderBy: [{ loadDate: 'asc' }, { id: 'asc' }],
      select: { loadDate: true },
    });
    if (pending) {
      const pendingPeriod = businessPeriodForDate(pending.loadDate);
      if (
        !earliest ||
        pendingPeriod.year < earliest.year ||
        (pendingPeriod.year === earliest.year && pendingPeriod.month < earliest.month)
      ) {
        earliest = pendingPeriod;
      }
    }
  }
  return earliest;
}

/**
 * Valida si un vehículo puede registrar una carga de X monto en el mes en curso.
 * Usa lock pesimista para evitar race conditions.
 * Retorna info para UI o bloqueo.
 */
export async function checkAndReserveFuelBudget(
  tx: Tx,
  vehicleId: number,
  amount: number,
  period: BudgetPeriod = businessPeriodForDate(),
) {
  const { year, month } = period;

  // Todas las mutaciones del periodo comparten el mismo advisory lock. Así,
  // una aprobación no puede cruzarse con el cierre o una redistribución.
  await lockBudgetTimelineShared(tx, 'FUEL');
  await lockBudgetPeriod(tx, 'FUEL', year, month);
  await assertBudgetPeriodOpen(tx, 'FUEL', year, month);

  // Lock pesimista — evita que dos cargas concurrentes del mismo vehículo se cuelen
  const rows = await tx.$queryRaw<
    Array<{
      id: number;
      baseAmount: string;
      rolloverIn: string;
      spentAmount: string;
      isClosed: boolean;
      isCutOff: boolean;
    }>
  >`
    SELECT id, "baseAmount"::text, "rolloverIn"::text, "spentAmount"::text,
           "isClosed", "isCutOff"
    FROM vehicle_budgets
    WHERE "vehicleId" = ${vehicleId}
      AND kind = 'FUEL'::"BudgetKind"
      AND year = ${year}
      AND month = ${month}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    // Sin presupuesto: permitimos la carga (decisión de negocio; si quieres bloquear, cambiar a throw)
    return { allowed: true, available: null, reason: 'SIN_PRESUPUESTO' };
  }

  const b = rows[0];
  const available = Number(b.baseAmount) + Number(b.rolloverIn) - Number(b.spentAmount);

  if (b.isClosed) {
    throw Conflict('El periodo presupuestal de la carga ya está cerrado');
  }

  if (b.isCutOff || amount > available) {
    return { allowed: false, available, reason: 'EXCEDE', budgetId: b.id };
  }

  // Actualiza spentAmount en el mismo lock
  await tx.vehicleBudget.update({
    where: { id: b.id },
    data: { spentAmount: { increment: amount } },
  });

  const remaining = available - amount;
  const totalBudget = Number(b.baseAmount) + Number(b.rolloverIn);
  const pct = totalBudget > 0 ? ((totalBudget - remaining) / totalBudget) * 100 : 0;

  // Flag cutoff si ya no queda
  if (remaining <= 0) {
    await tx.vehicleBudget.update({
      where: { id: b.id },
      data: { isCutOff: true },
    });
  }

  return { allowed: true, available: remaining, reason: 'OK', budgetId: b.id, percentage: pct };
}

/**
 * Revierte un cargo histórico únicamente cuando un administrador declaró que
 * sí fue aplicado. Si el mes cerró, compensa la cadena de rollover completa
 * hasta la primera fila abierta bajo locks cronológicos.
 */
export async function releaseFuelBudget(
  tx: Tx,
  vehicleId: number,
  amount: number,
  period: BudgetPeriod,
) {
  await lockBudgetTimelineShared(tx, 'FUEL');
  await lockBudgetPeriod(tx, 'FUEL', period.year, period.month);
  // Orden global: timeline -> periodo -> vehículo -> presupuesto. Mantenerlo
  // evita interbloqueos con aprobaciones de carga y con la baja lógica.
  const vehicleRows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
    SELECT "isActive"
    FROM vehicles
    WHERE id = ${vehicleId}
    FOR UPDATE
  `;
  if (vehicleRows.length === 0) throw Conflict('El vehículo del presupuesto ya no existe');
  const vehicleIsActive = vehicleRows[0].isActive;
  const budget = await lockFuelBudget(tx, vehicleId, period);
  if (!budget) {
    throw Conflict('No existe presupuesto para revertir el efecto declarado');
  }

  const amountDecimal = new Prisma.Decimal(amount);
  const spent = new Prisma.Decimal(budget.spentAmount);
  if (spent.lessThan(amountDecimal)) {
    throw Conflict('El gasto registrado no alcanza para revertir esta carga con seguridad');
  }

  const total = new Prisma.Decimal(budget.baseAmount).plus(budget.rolloverIn);
  const spentAfterRelease = spent.minus(amountDecimal);
  const availableAfterRelease = total.minus(spentAfterRelease);
  const oldRemainder = Prisma.Decimal.max(total.minus(spent), 0);
  const newRemainder = Prisma.Decimal.max(availableAfterRelease, 0);
  let carry = newRemainder.minus(oldRemainder);

  // Una corrección histórica puede ocurrir después de la baja. Si alcanza
  // una fila abierta, el nuevo remanente vuelve al pote y no reabre presupuesto
  // para la unidad inactiva.
  if (!vehicleIsActive && !budget.isClosed) {
    const normalizedBase = Prisma.Decimal.min(
      new Prisma.Decimal(budget.baseAmount),
      spentAfterRelease,
    );
    const normalizedRollover = Prisma.Decimal.min(
      new Prisma.Decimal(budget.rolloverIn),
      Prisma.Decimal.max(spentAfterRelease.minus(budget.baseAmount), 0),
    );
    const normalizedAvailable = normalizedBase
      .plus(normalizedRollover)
      .minus(spentAfterRelease);
    await tx.vehicleBudget.update({
      where: { id: budget.id },
      data: {
        spentAmount: spentAfterRelease,
        baseAmount: normalizedBase,
        rolloverIn: normalizedRollover,
        isCutOff: true,
      },
    });
    return {
      budgetId: budget.id,
      availableAfterRelease: Number(normalizedAvailable),
      rolloverAdjustedBudgetIds: [] as number[],
    };
  }

  await tx.vehicleBudget.update({
    where: { id: budget.id },
    data: {
      spentAmount: { decrement: amountDecimal },
      isCutOff: availableAfterRelease.lessThanOrEqualTo(0),
    },
  });

  // Propaga solo el aumento real del remanente. Un déficit en cualquier mes
  // absorbe primero la liberación y no crea rollover que nunca existió.
  const rolloverAdjustedBudgetIds: number[] = [];
  let cursor = period;
  let cursorBudget = budget;
  for (
    let depth = 0;
    cursorBudget.isClosed && carry.greaterThan(0);
    depth += 1
  ) {
    if (depth >= 120) {
      throw Conflict('La cadena de rollover excede el límite de seguridad');
    }
    cursor = nextMonth(cursor.year, cursor.month);
    // Se adquieren siempre en orden cronológico para evitar interbloqueos con
    // el cierre mensual, que usa exactamente el mismo orden.
    await lockBudgetPeriod(tx, 'FUEL', cursor.year, cursor.month);
    const nextBudget = await lockFuelBudget(tx, vehicleId, cursor);
    if (!nextBudget) {
      if (!vehicleIsActive) break;
      throw Conflict(
        `Cadena de rollover incompleta en ${cursor.month}/${cursor.year}`,
      );
    }
    if (!vehicleIsActive && !nextBudget.isClosed) break;
    const nextTotalBefore = new Prisma.Decimal(nextBudget.baseAmount)
      .plus(nextBudget.rolloverIn);
    const nextSpent = new Prisma.Decimal(nextBudget.spentAmount);
    const nextOldRemainder = Prisma.Decimal.max(
      nextTotalBefore.minus(nextSpent),
      0,
    );
    const nextAvailable = nextTotalBefore.plus(carry).minus(nextSpent);
    const nextNewRemainder = Prisma.Decimal.max(nextAvailable, 0);
    await tx.vehicleBudget.update({
      where: { id: nextBudget.id },
      data: {
        rolloverIn: { increment: carry },
        isCutOff: nextAvailable.lessThanOrEqualTo(0),
      },
    });
    rolloverAdjustedBudgetIds.push(nextBudget.id);
    carry = nextBudget.isClosed
      ? nextNewRemainder.minus(nextOldRemainder)
      : new Prisma.Decimal(0);
    cursorBudget = nextBudget;
  }

  return {
    budgetId: budget.id,
    availableAfterRelease: Number(availableAfterRelease),
    rolloverAdjustedBudgetIds,
  };
}

/**
 * Cierra el mes dado y aplica rollover al siguiente (idempotente).
 * Se llama desde el barrido diario de periodos vencidos o manualmente.
 */
export async function closeMonthAndRollover(input: CloseMonthInput) {
  const { year, month, kind } = input;
  const current = businessPeriodForDate();
  if (year > current.year || (year === current.year && month >= current.month)) {
    throw BadRequest('Solo se pueden cerrar periodos anteriores al mes actual');
  }
  const next = nextMonth(year, month);

  const kinds: BudgetKind[] = kind ? [kind] : ['FUEL', 'MAINTENANCE'];

  const result: Array<{
    kind: BudgetKind;
    closed: number;
    rolledOver: number;
    remainderTotal: number;
    deferredPendingFuelLoads: number;
    deferredEarlierPeriod: BudgetPeriod | null;
  }> = [];

  for (const k of kinds) {
    const summary = await prisma.$transaction(async (tx) => {
      await lockBudgetTimelineExclusive(tx, k);
      await lockBudgetPeriod(tx, k, year, month);

      if (await isBudgetPeriodClosed(tx, k, year, month)) {
        return {
          closed: 0,
          rolledOver: 0,
          remainderTotal: 0,
          deferredPendingFuelLoads: 0,
          deferredEarlierPeriod: null,
        };
      }

      const earlierOpenPeriod = await findEarlierOpenBudgetPeriod(
        tx,
        k,
        { year, month },
      );
      if (earlierOpenPeriod) {
        return {
          closed: 0,
          rolledOver: 0,
          remainderTotal: 0,
          deferredPendingFuelLoads: 0,
          deferredEarlierPeriod: earlierOpenPeriod,
        };
      }

      if (k === 'FUEL') {
        const periodEnd = nextMonth(year, month);
        const pendingFuelLoads = await tx.fuelLoad.count({
          where: {
            status: 'PENDING_REVIEW',
            loadDate: {
              gte: periodStart(year, month),
              lt: periodStart(periodEnd.year, periodEnd.month),
            },
          },
        });
        if (pendingFuelLoads > 0) {
          return {
            closed: 0,
            rolledOver: 0,
            remainderTotal: 0,
            deferredPendingFuelLoads: pendingFuelLoads,
            deferredEarlierPeriod: null,
          };
        }
      }

      // El rollover escribe el periodo siguiente; se bloquea después del
      // origen para mantener un orden cronológico único entre operaciones.
      await lockBudgetPeriod(tx, k, next.year, next.month);
      if (await isBudgetPeriodClosed(tx, k, next.year, next.month)) {
        throw Conflict(
          `El periodo siguiente ${next.month}/${next.year} ya está cerrado; ` +
          'no se puede alterar su rollover',
        );
      }

      // Lectura DENTRO de la tx con lock pesimista (FOR UPDATE) sobre las filas
      // abiertas del mes a cerrar. Si el job se dispara dos veces (reintento de
      // BullMQ, doble instancia de API, o manual + cron), la 2ª corrida espera el
      // commit de la 1ª y entonces ve isClosed=true → 0 filas → rollover
      // exactly-once (sin doble crédito del remanente al mes siguiente).
      const openBudgets = await tx.$queryRaw<
        Array<{
          id: number;
          vehicleId: number;
          isActive: boolean;
          baseAmount: string;
          rolloverIn: string;
          spentAmount: string;
        }>
      >`
        SELECT vb.id, vb."vehicleId", v."isActive",
               vb."baseAmount"::text, vb."rolloverIn"::text, vb."spentAmount"::text
        FROM vehicle_budgets vb
        JOIN vehicles v ON v.id = vb."vehicleId"
        WHERE vb.year = ${year} AND vb.month = ${month}
          AND vb.kind = ${k}::"BudgetKind" AND vb."isClosed" = false
        ORDER BY vb."vehicleId"
        FOR UPDATE OF vb
      `;

      let rolledCount = 0;
      let totalRemainder = 0;

      for (const b of openBudgets) {
        const available = Number(b.baseAmount) + Number(b.rolloverIn) - Number(b.spentAmount);
        const remainder = Math.max(0, available);

        // La fila abierta de una unidad dada de baja se conserva y se cierra
        // como historia, pero su saldo ya fue liberado al desactivarla y nunca
        // debe originar una asignación en el periodo siguiente.
        if (!b.isActive) continue;
        totalRemainder += remainder;

        // Upsert: si ya existe el siguiente mes, suma al rolloverIn (idempotente)
        await tx.vehicleBudget.upsert({
          where: {
            vehicleId_kind_year_month: {
              vehicleId: b.vehicleId,
              kind: k,
              year: next.year,
              month: next.month,
            },
          },
          create: {
            vehicleId: b.vehicleId, kind: k,
            year: next.year, month: next.month,
            baseAmount: 0, rolloverIn: remainder, spentAmount: 0,
          },
          update: {
            rolloverIn: { increment: remainder },
          },
        });

        rolledCount++;
      }

      // Marcar como cerrados en UNA sola escritura (las filas ya están bloqueadas).
      const closedAt = new Date();
      if (openBudgets.length > 0) {
        await tx.vehicleBudget.updateMany({
          where: { id: { in: openBudgets.map((b) => b.id) } },
          data: { isClosed: true, closedAt },
        });
      }
      await tx.monthlyBudget.upsert({
        where: { kind_year_month: { kind: k, year, month } },
        create: {
          kind: k,
          year,
          month,
          totalAmount: 0,
          isClosed: true,
          closedAt,
        },
        update: { isClosed: true, closedAt },
      });

      return {
        closed: openBudgets.length,
        rolledOver: rolledCount,
        remainderTotal: totalRemainder,
        deferredPendingFuelLoads: 0,
        deferredEarlierPeriod: null,
      };
    }, { timeout: 60_000, maxWait: 10_000 });

    result.push({ kind: k, ...summary });
  }

  return { year, month, results: result };
}

/**
 * Reintenta todos los periodos vencidos que aún conservan presupuestos
 * abiertos. No se limita al mes anterior: una carga pendiente por varias
 * semanas no puede hacer que el cambio de calendario abandone ese cierre.
 */
export async function closeOverdueBudgetPeriods(now = new Date()) {
  const current = businessPeriodForDate(now);
  const [vehiclePeriods, poolPeriods] = await Promise.all([
    prisma.vehicleBudget.findMany({
      where: {
        isClosed: false,
        OR: [
          { year: { lt: current.year } },
          { year: current.year, month: { lt: current.month } },
        ],
      },
      select: { year: true, month: true },
      distinct: ['year', 'month'],
    }),
    prisma.monthlyBudget.findMany({
      where: {
        isClosed: false,
        OR: [
          { year: { lt: current.year } },
          { year: current.year, month: { lt: current.month } },
        ],
      },
      select: { year: true, month: true },
      distinct: ['year', 'month'],
    }),
  ]);
  const periods = [...new Map(
    [...vehiclePeriods, ...poolPeriods]
      .map((period) => [`${period.year}-${period.month}`, period]),
  ).values()].sort((a, b) => a.year - b.year || a.month - b.month);

  const closed: Awaited<ReturnType<typeof closeMonthAndRollover>>[] = [];
  for (const period of periods) {
    closed.push(await closeMonthAndRollover(period));
  }

  return { currentPeriod: current, periods: closed };
}

// (Se eliminó recordBudgetSpending: era código muerto — ningún call-site lo
// usaba; el gasto real pasa por checkAndReserveFuelBudget dentro de fuelLoadService.
// Nota: las notificaciones de presupuesto al 80%/100% vivían SOLO aquí, por lo
// que nunca se disparaban; cablearlas es una decisión de feature aparte.)

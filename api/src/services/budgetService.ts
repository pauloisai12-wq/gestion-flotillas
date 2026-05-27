// /api/src/services/budgetService.ts
// Servicio v2 — lógica transaccional de presupuestos con rollover

import prisma, { type Tx } from '../lib/prisma';
import { BudgetKind, Prisma } from '@prisma/client';
import { CloseMonthInput } from '../validators/budgetValidator';
import { notifyByRole } from './notificationService';

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

/**
 * Valida si un vehículo puede registrar una carga de X monto en el mes en curso.
 * Usa lock pesimista para evitar race conditions.
 * Retorna info para UI o bloqueo.
 */
export async function checkAndReserveFuelBudget(
  tx: Tx,
  vehicleId: number,
  amount: number,
) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Lock pesimista — evita que dos cargas concurrentes del mismo vehículo se cuelen
  const rows = await tx.$queryRaw<
    Array<{ id: number; baseAmount: string; rolloverIn: string; spentAmount: string }>
  >`
    SELECT id, "baseAmount"::text, "rolloverIn"::text, "spentAmount"::text
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

  if (amount > available) {
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
 * Cierra el mes dado y aplica rollover al siguiente (idempotente).
 * Se llama desde cron (día 1 00:05 AM) o manualmente.
 */
export async function closeMonthAndRollover(input: CloseMonthInput) {
  const { year, month, kind } = input;
  const next = nextMonth(year, month);

  const kinds: BudgetKind[] = kind ? [kind] : ['FUEL', 'MAINTENANCE'];

  const result: { kind: BudgetKind; closed: number; rolledOver: number; remainderTotal: number }[] = [];

  for (const k of kinds) {
    // Presupuestos del mes a cerrar que NO estén ya cerrados
    const openBudgets = await prisma.vehicleBudget.findMany({
      where: { year, month, kind: k, isClosed: false },
    });

    let rolledCount = 0;
    let totalRemainder = 0;

    await prisma.$transaction(async (tx) => {
      for (const b of openBudgets) {
        const available = Number(b.baseAmount) + Number(b.rolloverIn) - Number(b.spentAmount);
        const remainder = Math.max(0, available);
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

        await tx.vehicleBudget.update({
          where: { id: b.id },
          data: { isClosed: true, closedAt: new Date() },
        });

        rolledCount++;
      }
    });

    result.push({ kind: k, closed: openBudgets.length, rolledOver: rolledCount, remainderTotal: totalRemainder });
  }

  return { year, month, results: result };
}

/**
 * Helper legacy — mantenido para compatibilidad con código que aún llame a recordBudgetSpending.
 * Llama al nuevo flujo dentro de una tx externa.
 */
export async function recordBudgetSpending(vehicleId: number, amount: number) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return prisma.$transaction(async (tx) => {
    const res = await checkAndReserveFuelBudget(tx, vehicleId, amount);
    if (res.reason === 'EXCEDE') throw new Error(`Excede presupuesto disponible: $${res.available}`);

    // Notificaciones
    if (res.percentage && res.percentage >= 80 && res.percentage < 100) {
      await notifyByRole({
        role: 'SUPERVISOR_FUEL' as never,
        type: 'BUDGET_WARNING',
        title: `Presupuesto al ${Math.round(res.percentage)}%`,
        message: `Vehículo ID ${vehicleId} consumió ${Math.round(res.percentage)}% de su presupuesto de combustible.`,
        entityRef: `vehicle:${vehicleId}`,
      });
    }
    if ((res.available ?? Infinity) <= 0) {
      await notifyByRole({
        role: 'ADMIN' as never,
        type: 'BUDGET_EXCEEDED',
        title: 'Presupuesto agotado',
        message: `Vehículo ID ${vehicleId} alcanzó 100% de su presupuesto. Cargas bloqueadas.`,
        entityRef: `vehicle:${vehicleId}`,
      });
    }

    return res;
  });
}

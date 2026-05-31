// /api/src/services/budgetService.ts
// Servicio v2 — lógica transaccional de presupuestos con rollover

import prisma, { type Tx } from '../lib/prisma';
import { BudgetKind, Prisma } from '@prisma/client';
import { CloseMonthInput } from '../validators/budgetValidator';

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

/** Periodo presupuestal actual (mes/año) en la zona horaria del negocio
 *  (America/Mexico_City), evitando el desfase de la hora local del servidor
 *  cerca de la frontera de mes. */
function currentBudgetPeriod(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === 'year')!.value),
    month: Number(parts.find((p) => p.type === 'month')!.value),
  };
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
  const { year, month } = currentBudgetPeriod();

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
    const summary = await prisma.$transaction(async (tx) => {
      // Lectura DENTRO de la tx con lock pesimista (FOR UPDATE) sobre las filas
      // abiertas del mes a cerrar. Si el job se dispara dos veces (reintento de
      // BullMQ, doble instancia de API, o manual + cron), la 2ª corrida espera el
      // commit de la 1ª y entonces ve isClosed=true → 0 filas → rollover
      // exactly-once (sin doble crédito del remanente al mes siguiente).
      const openBudgets = await tx.$queryRaw<
        Array<{ id: number; vehicleId: number; baseAmount: string; rolloverIn: string; spentAmount: string }>
      >`
        SELECT id, "vehicleId", "baseAmount"::text, "rolloverIn"::text, "spentAmount"::text
        FROM vehicle_budgets
        WHERE year = ${year} AND month = ${month}
          AND kind = ${k}::"BudgetKind" AND "isClosed" = false
        FOR UPDATE
      `;

      let rolledCount = 0;
      let totalRemainder = 0;

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

        rolledCount++;
      }

      // Marcar como cerrados en UNA sola escritura (las filas ya están bloqueadas).
      if (openBudgets.length > 0) {
        await tx.vehicleBudget.updateMany({
          where: { id: { in: openBudgets.map((b) => b.id) } },
          data: { isClosed: true, closedAt: new Date() },
        });
      }

      return { closed: openBudgets.length, rolledOver: rolledCount, remainderTotal: totalRemainder };
    }, { timeout: 60_000, maxWait: 10_000 });

    result.push({ kind: k, closed: summary.closed, rolledOver: summary.rolledOver, remainderTotal: summary.remainderTotal });
  }

  return { year, month, results: result };
}

// (Se eliminó recordBudgetSpending: era código muerto — ningún call-site lo
// usaba; el gasto real pasa por checkAndReserveFuelBudget dentro de fuelLoadService.
// Nota: las notificaciones de presupuesto al 80%/100% vivían SOLO aquí, por lo
// que nunca se disparaban; cablearlas es una decisión de feature aparte.)

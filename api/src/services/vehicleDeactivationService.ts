import { BudgetKind, MaintenanceTicketStatus, Prisma } from '@prisma/client';
import { getAuditContext } from '../lib/auditContext';
import type { Tx } from '../lib/prisma';
import { Conflict, NotFound } from '../middlewares/errorHandler';
import { lockBudgetTimelineExclusive } from './budgetPeriodLock';

const BUDGET_KINDS: BudgetKind[] = ['FUEL', 'MAINTENANCE'];
const NON_TERMINAL_TICKET_STATUSES: MaintenanceTicketStatus[] = [
  'PENDING_ADMIN_APPROVAL',
  'AWAITING_QUOTES',
  'APPROVED_FOR_REPAIR',
  'IN_REPAIR',
];

type LockedVehicle = {
  id: number;
  isActive: boolean;
  executorId: number | null;
};

type OpenBudgetSnapshot = {
  id: number;
  kind: BudgetKind;
  year: number;
  month: number;
  baseAmount: string;
  rolloverIn: string;
  spentAmount: string;
};

export interface VehicleDeactivationOptions {
  actorUserId?: number | null;
  source: 'ADMIN_DELETE' | 'VEHICLE_IMPORT';
}

function normalizeOpenBudget(budget: OpenBudgetSnapshot) {
  const baseAmount = new Prisma.Decimal(budget.baseAmount);
  const rolloverIn = new Prisma.Decimal(budget.rolloverIn);
  const spentAmount = new Prisma.Decimal(budget.spentAmount);
  const normalizedBase = Prisma.Decimal.min(baseAmount, spentAmount);
  const rolloverConsumed = Prisma.Decimal.max(spentAmount.minus(baseAmount), 0);
  const normalizedRollover = Prisma.Decimal.min(rolloverIn, rolloverConsumed);
  return {
    ...budget,
    baseAmount: normalizedBase.toFixed(2),
    rolloverIn: normalizedRollover.toFixed(2),
    releasedBase: baseAmount.minus(normalizedBase),
    releasedRollover: rolloverIn.minus(normalizedRollover),
  };
}

/**
 * Da de baja una unidad dentro de una transacción ya abierta.
 *
 * El orden de locks coincide con presupuesto (timeline -> vehículo). Los dos
 * timelines quedan exclusivos para que ninguna distribución, reserva o cierre
 * pueda cruzarse con la liberación de saldos. Los presupuestos cerrados son
 * intocables; en los abiertos se conserva el gasto real y se devuelve al pote
 * únicamente la parte todavía disponible.
 */
export async function deactivateVehicleInTransaction(
  tx: Tx,
  vehicleId: number,
  options: VehicleDeactivationOptions,
) {
  for (const kind of BUDGET_KINDS) {
    await lockBudgetTimelineExclusive(tx, kind);
  }

  const vehicles = await tx.$queryRaw<LockedVehicle[]>`
    SELECT id, "isActive", "executorId"
    FROM vehicles
    WHERE id = ${vehicleId}
    FOR UPDATE
  `;
  const current = vehicles[0];
  if (!current || !current.isActive) throw NotFound('Vehículo activo');

  // Los timelines ya están bloqueados y la fila del vehículo está en FOR
  // UPDATE. Una aprobación concurrente que alcanzó a reservar presupuesto
  // termina antes y aparece aquí; una que aún no obtuvo el timeline revalidará
  // isActive después. No se bloquea la fila del ticket para evitar invertir el
  // orden ticket -> timeline usado por approveTicket.
  const pendingTicket = await tx.maintenanceTicket.findFirst({
    where: {
      vehicleId,
      status: { in: NON_TERMINAL_TICKET_STATUSES },
    },
    select: { id: true, folio: true, status: true },
    orderBy: { id: 'asc' },
  });
  if (pendingTicket) {
    throw Conflict(
      `No se puede dar de baja el vehículo mientras el ticket ${pendingTicket.folio ?? `#${pendingTicket.id}`} siga en estado ${pendingTicket.status}`,
    );
  }

  const openBudgets = await tx.$queryRaw<OpenBudgetSnapshot[]>`
    SELECT id, kind, year, month,
           "baseAmount"::text, "rolloverIn"::text, "spentAmount"::text
    FROM vehicle_budgets
    WHERE "vehicleId" = ${vehicleId}
      AND "isClosed" = false
    ORDER BY kind, year, month
    FOR UPDATE
  `;

  const actorUserId = options.actorUserId ?? null;
  if (openBudgets.length > 0) {
    // No se borran filas ni se alteran periodos cerrados. Base y rollover se
    // reducen solo en su porción no consumida. Si existía sobregiro, se conserva
    // el déficit en vez de inventar presupuesto para igualarlo al gasto.
    await tx.$executeRaw`
      UPDATE vehicle_budgets
      SET "baseAmount" = LEAST("baseAmount", "spentAmount"),
          "rolloverIn" = LEAST(
            "rolloverIn",
            GREATEST("spentAmount" - "baseAmount", 0)
          ),
          "isCutOff" = true,
          "updatedBy" = COALESCE(${actorUserId}::integer, "updatedBy"),
          "updatedAt" = NOW()
      WHERE "vehicleId" = ${vehicleId}
        AND "isClosed" = false
    `;
  }

  const deactivatedAt = new Date();
  await tx.vehicleAssignment.updateMany({
    where: { vehicleId, endDate: null },
    data: { endDate: deactivatedAt },
  });

  const vehicle = await tx.vehicle.update({
    where: { id: vehicleId, isActive: true },
    data: { isActive: false, executorId: null },
  });

  const normalizedBudgets = openBudgets.map(normalizeOpenBudget);
  const releasedBase = normalizedBudgets.reduce(
    (sum, budget) => sum.plus(budget.releasedBase),
    new Prisma.Decimal(0),
  );
  const releasedRollover = normalizedBudgets.reduce(
    (sum, budget) => sum.plus(budget.releasedRollover),
    new Prisma.Decimal(0),
  );
  const auditContext = getAuditContext();
  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: 'DEACTIVATE',
      resource: 'Vehicle',
      resourceId: String(vehicleId),
      before: {
        isActive: true,
        executorId: current.executorId,
        openBudgets,
      },
      after: {
        isActive: false,
        executorId: null,
        openBudgets: normalizedBudgets.map((budget) => ({
          id: budget.id,
          baseAmount: budget.baseAmount,
          rolloverIn: budget.rolloverIn,
          spentAmount: budget.spentAmount,
          isCutOff: true,
        })),
      },
      metadata: {
        source: options.source,
        releasedBase: releasedBase.toFixed(2),
        releasedRollover: releasedRollover.toFixed(2),
        affectedOpenBudgets: openBudgets.length,
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
      requestId: auditContext?.requestId,
    },
  });

  return {
    vehicle,
    releasedBase: Number(releasedBase),
    releasedRollover: Number(releasedRollover),
    affectedOpenBudgets: openBudgets.length,
  };
}

// /api/src/services/tickets/shared.ts
// Definiciones y helpers comunes al flujo de tickets de mantenimiento.

import prisma, { type Tx } from '../../lib/prisma';

export const MAX_ATTACHMENTS = 5;

/**
 * Error de dominio del flujo de tickets. El router lo mapea a HTTP:
 *   NOT_FOUND → 404, FORBIDDEN → 403, BAD_REQUEST → 400,
 *   INVALID_STATE → 409 (o 400 según convención del router),
 *   BUDGET_EXCEEDED → 422 / 409.
 */
export class TicketError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_STATE' | 'BAD_REQUEST' | 'BUDGET_EXCEEDED',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Carga el ticket y valida que `workshopUserId` pertenezca al taller
 * ganador. Usado por las acciones del taller (start/completeRepair).
 */
export async function loadTicketForWinningWorkshop(ticketId: number, workshopUserId: number) {
  const user = await prisma.user.findUnique({
    where: { id: workshopUserId },
    select: { workshopId: true, role: true },
  });
  if (!user || user.role !== 'WORKSHOP' || !user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Cuenta sin taller vinculado');
  }

  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    include: { selectedQuote: true },
  });
  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');
  if (!ticket.selectedQuote || ticket.selectedQuote.workshopId !== user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Tu taller no es el ganador de este ticket');
  }
  return ticket;
}

/**
 * Reserva monto del presupuesto de mantenimiento del vehículo en el mes en curso.
 * Misma semántica que checkAndReserveFuelBudget de budgetService pero para MAINTENANCE.
 */
export async function reserveMaintenanceBudget(tx: Tx, vehicleId: number, amount: number) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const rows = await tx.$queryRaw<
    Array<{ id: number; baseAmount: string; rolloverIn: string; spentAmount: string }>
  >`
    SELECT id, "baseAmount"::text, "rolloverIn"::text, "spentAmount"::text
    FROM vehicle_budgets
    WHERE "vehicleId" = ${vehicleId}
      AND kind = 'MAINTENANCE'::"BudgetKind"
      AND year = ${year}
      AND month = ${month}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    return { allowed: false, available: null as number | null };
  }

  const b = rows[0];
  const available = Number(b.baseAmount) + Number(b.rolloverIn) - Number(b.spentAmount);
  if (amount > available) {
    return { allowed: false, available };
  }

  // Saldo que quedará tras reservar este monto. Cortamos el presupuesto cuando
  // se agota (remaining <= 0), igual que checkAndReserveFuelBudget; NO usamos
  // igualdad estricta de floats (casi nunca verdadera). Si queda saldo, dejamos
  // isCutOff SIN tocar (undefined) para no resetear un corte previo.
  const remaining = available - amount;
  await tx.vehicleBudget.update({
    where: { id: b.id },
    data: {
      spentAmount: { increment: amount },
      isCutOff: remaining <= 0 ? true : undefined,
    },
  });

  return { allowed: true, available: remaining };
}

/** Notifica a todos los admins de mantenimiento (ADMIN + SUPERVISOR_MAINTENANCE). */
export async function notifyTicketAdmins(params: {
  type:
    | 'MAINTENANCE_TICKET_CREATED'
    | 'MAINTENANCE_QUOTE_SUBMITTED'
    | 'MAINTENANCE_REPAIR_STARTED'
    | 'MAINTENANCE_REPAIR_COMPLETED';
  title: string;
  message: string;
  entityRef?: string;
}) {
  const users = await prisma.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPERVISOR_MAINTENANCE'] },
      isActive: true,
    },
    select: { id: true },
  });
  if (users.length === 0) return;
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: params.type,
      title: params.title,
      message: params.message,
      entityRef: params.entityRef ?? null,
      read: false,
    })),
  });
}

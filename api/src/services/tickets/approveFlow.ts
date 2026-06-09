// /api/src/services/tickets/approveFlow.ts
// Aprobación de cotización + reparación: ADMIN aprueba, TALLER GANADOR
// inicia y completa.

import prisma from '../../lib/prisma';
import {
  ApproveTicketInput,
  CompleteRepairInput,
} from '../../validators/maintenanceTicketValidator';
import { createNotification } from '../notificationService';
import {
  TicketError,
  loadTicketForWinningWorkshop,
  reserveMaintenanceBudget,
  notifyTicketAdmins,
} from './shared';

// ─── ADMIN: aprobar cotización ganadora → APPROVED_FOR_REPAIR ─────
export async function approveTicket(
  ticketId: number,
  adminId: number,
  input: ApproveTicketInput,
) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    include: {
      vehicle: { select: { id: true, economicNumber: true, plate: true } },
      quotes: { include: { workshop: { select: { user: { select: { id: true } } } } } },
    },
  });
  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');
  if (ticket.status !== 'AWAITING_QUOTES') {
    throw new TicketError('INVALID_STATE', `Solo se puede aprobar en AWAITING_QUOTES (actual: ${ticket.status})`);
  }

  const winningQuote = ticket.quotes.find((q) => q.id === input.selectedQuoteId);
  if (!winningQuote) {
    throw new TicketError('BAD_REQUEST', 'La cotización seleccionada no pertenece a este ticket');
  }
  if (!winningQuote.submittedAt || !winningQuote.amount) {
    throw new TicketError('BAD_REQUEST', 'La cotización seleccionada no fue enviada');
  }
  if (winningQuote.declinedAt) {
    throw new TicketError('BAD_REQUEST', 'La cotización fue declinada');
  }

  const amount = Number(winningQuote.amount);

  // Transacción atómica: compare-and-swap del estado + reserva presupuesto +
  // marca quote ganadora + actualiza ticket.
  const result = await prisma.$transaction(async (tx) => {
    // CAS atómico ANTES de reservar presupuesto: si otra petición concurrente
    // (doble-click o dos admins) ya aprobó, esto afecta 0 filas y abortamos por
    // rollback sin descontar el presupuesto dos veces. El chequeo de estado de
    // arriba (fuera de la tx) es solo un fast-fail; esta es la barrera real.
    const swap = await tx.maintenanceTicket.updateMany({
      where: { id: ticketId, status: 'AWAITING_QUOTES' },
      data: { status: 'APPROVED_FOR_REPAIR' },
    });
    if (swap.count === 0) {
      throw new TicketError('INVALID_STATE', 'El ticket ya fue aprobado o cambió de estado');
    }

    const budgetResult = await reserveMaintenanceBudget(tx, ticket.vehicleId, amount);
    if (!budgetResult.allowed) {
      throw new TicketError(
        'BUDGET_EXCEEDED',
        budgetResult.available !== null
          ? `Excede presupuesto: disponible $${budgetResult.available.toFixed(2)}, requerido $${amount.toFixed(2)}`
          : 'Sin presupuesto asignado para mantenimiento este mes',
      );
    }

    await tx.ticketQuote.update({
      where: { id: winningQuote.id },
      data: { isWinner: true },
    });

    // El status ya se fijó en el CAS; aquí completamos los metadatos de aprobación.
    return tx.maintenanceTicket.update({
      where: { id: ticketId },
      data: {
        finalConcept: input.finalConcept,
        selectedQuoteId: winningQuote.id,
        approvedByAdminId: adminId,
        approvedAt: new Date(),
      },
      include: { selectedQuote: { include: { workshop: true } } },
    });
  });

  // Notificaciones fuera de la transacción para no extenderla.
  await createNotification({
    userId: ticket.requestedById,
    type: 'MAINTENANCE_TICKET_APPROVED',
    title: 'Tu solicitud fue aprobada',
    message: `Vehículo ${ticket.vehicle.economicNumber} — ${input.finalConcept.slice(0, 120)}`,
    entityRef: `ticket:${ticket.id}`,
  });
  const winningWorkshopUser = winningQuote.workshop.user?.id;
  if (winningWorkshopUser) {
    await createNotification({
      userId: winningWorkshopUser,
      type: 'MAINTENANCE_TICKET_APPROVED',
      title: 'Tu cotización fue aceptada',
      message: `Procede con la reparación del ticket #${ticket.id}`,
      entityRef: `ticket:${ticket.id}`,
    });
  }

  return result;
}

// ─── TALLER GANADOR: iniciar reparación → IN_REPAIR ───────────────
export async function startRepair(ticketId: number, workshopUserId: number) {
  const ticket = await loadTicketForWinningWorkshop(ticketId, workshopUserId);
  if (ticket.status !== 'APPROVED_FOR_REPAIR') {
    throw new TicketError('INVALID_STATE', `Solo se puede iniciar en APPROVED_FOR_REPAIR (actual: ${ticket.status})`);
  }

  const updated = await prisma.maintenanceTicket.update({
    where: { id: ticketId },
    data: { status: 'IN_REPAIR', repairStartedAt: new Date() },
  });

  await notifyTicketAdmins({
    type: 'MAINTENANCE_REPAIR_STARTED',
    title: 'Reparación iniciada',
    message: `Ticket #${ticketId}`,
    entityRef: `ticket:${ticketId}`,
  });
  await createNotification({
    userId: ticket.requestedById,
    type: 'MAINTENANCE_REPAIR_STARTED',
    title: 'Reparación iniciada en tu vehículo',
    message: `Ticket #${ticketId}`,
    entityRef: `ticket:${ticketId}`,
  });

  return updated;
}

// ─── TALLER GANADOR: completar reparación → COMPLETED ─────────────
export async function completeRepair(
  ticketId: number,
  workshopUserId: number,
  input: CompleteRepairInput,
) {
  const ticket = await loadTicketForWinningWorkshop(ticketId, workshopUserId);
  if (ticket.status !== 'IN_REPAIR') {
    throw new TicketError('INVALID_STATE', `Solo se puede completar en IN_REPAIR (actual: ${ticket.status})`);
  }
  if (!ticket.selectedQuote?.amount || !ticket.selectedQuote.workshopId) {
    throw new TicketError('INVALID_STATE', 'Ticket sin cotización ganadora válida');
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: ticket.vehicleId },
    select: { vehicleTypeId: true, economicNumber: true },
  });
  if (!vehicle) throw new TicketError('NOT_FOUND', 'Vehículo no existe');

  const service = await prisma.serviceCatalog.findUnique({
    where: { id: input.serviceId },
    select: { id: true, vehicleTypeId: true, isActive: true },
  });
  if (!service || !service.isActive) {
    throw new TicketError('BAD_REQUEST', 'Servicio no existe o inactivo');
  }
  if (service.vehicleTypeId !== vehicle.vehicleTypeId) {
    throw new TicketError('BAD_REQUEST', 'El servicio elegido no aplica al tipo de vehículo');
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.maintenanceRecord.create({
      data: {
        vehicleId: ticket.vehicleId,
        serviceId: input.serviceId,
        workshopId: ticket.selectedQuote!.workshopId,
        cost: ticket.selectedQuote!.amount!,
        odometer:
          input.finalOdometerStatus === 'OK' ? (input.finalOdometer ?? null) : null,
        odometerStatus: input.finalOdometerStatus,
        serviceDate: now,
        notes: input.evidenceNotes ?? ticket.finalConcept ?? null,
      },
    });

    // Reflejar el odómetro en el vehículo, igual que maintenanceRecordService.create:
    // solo si la lectura es válida (OK) y mayor al actual. Así los semáforos de
    // servicio (getUpcomingServices/getAllPendingServices) no quedan desfasados.
    if (input.finalOdometerStatus === 'OK' && input.finalOdometer != null) {
      await tx.vehicle.updateMany({
        where: { id: ticket.vehicleId, currentOdometer: { lt: input.finalOdometer } },
        data: { currentOdometer: input.finalOdometer },
      });
    }

    // CAS atómico IN_REPAIR -> COMPLETED (con los campos que exige el CHECK
    // tickets_completed_consistency). Un doble submit del taller queda
    // serializado: el 2º ve count 0 y aborta, revirtiendo su record por rollback.
    const swap = await tx.maintenanceTicket.updateMany({
      where: { id: ticketId, status: 'IN_REPAIR' },
      data: { status: 'COMPLETED', repairCompletedAt: now, completedRecordId: record.id },
    });
    if (swap.count === 0) {
      throw new TicketError('INVALID_STATE', 'El ticket ya fue completado o cambió de estado');
    }
    return tx.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } });
  });

  await notifyTicketAdmins({
    type: 'MAINTENANCE_REPAIR_COMPLETED',
    title: 'Reparación completada',
    message: `Vehículo ${vehicle.economicNumber} — ticket #${ticketId}`,
    entityRef: `ticket:${ticketId}`,
  });
  await createNotification({
    userId: ticket.requestedById,
    type: 'MAINTENANCE_REPAIR_COMPLETED',
    title: 'Reparación completada',
    message: `Tu vehículo ${vehicle.economicNumber} ya está listo`,
    entityRef: `ticket:${ticketId}`,
  });

  return result;
}

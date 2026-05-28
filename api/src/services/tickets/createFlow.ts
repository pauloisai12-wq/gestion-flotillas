// /api/src/services/tickets/createFlow.ts
// Acciones tempranas del flujo de tickets:
//   - EJECUTOR: crea ticket, sube fotos.
//   - ADMIN: rechaza (filtro inicial) o asigna 3 talleres → AWAITING_QUOTES.

import prisma from '../../lib/prisma';
import { MaintenanceTicketStatus } from '@prisma/client';
import {
  CreateTicketInput,
  AssignWorkshopsInput,
} from '../../validators/maintenanceTicketValidator';
import { createNotification } from '../notificationService';
import { logger } from '../../lib/logger';
import { TicketError, MAX_ATTACHMENTS, notifyTicketAdmins } from './shared';

// ─── EJECUTOR: crear ticket ────────────────────────────────────────
export async function createTicket(executorId: number, input: CreateTicketInput) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: input.vehicleId },
    select: { id: true, executorId: true, isActive: true, economicNumber: true, plate: true },
  });

  if (!vehicle) throw new TicketError('NOT_FOUND', 'Vehículo no existe');
  if (!vehicle.isActive) throw new TicketError('BAD_REQUEST', 'Vehículo inactivo');
  if (vehicle.executorId !== executorId) {
    throw new TicketError('FORBIDDEN', 'No eres el ejecutor asignado a este vehículo');
  }

  const ticket = await prisma.maintenanceTicket.create({
    data: {
      vehicleId: input.vehicleId,
      requestedById: executorId,
      failureCategory: input.failureCategory,
      description: input.description,
      reportedOdometer: input.reportedOdometer ?? null,
      odometerStatus: input.odometerStatus,
    },
  });

  await notifyTicketAdmins({
    type: 'MAINTENANCE_TICKET_CREATED',
    title: 'Nuevo ticket de mantenimiento',
    message: `Vehículo ${vehicle.economicNumber} (${vehicle.plate}) — ${input.description.slice(0, 80)}`,
    entityRef: `ticket:${ticket.id}`,
  });

  return ticket;
}

// ─── EJECUTOR: subir foto al ticket ────────────────────────────────
export async function addAttachment(
  ticketId: number,
  executorId: number,
  file: { url: string; name: string; mimeType?: string; sizeBytes?: number },
) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      requestedById: true,
      status: true,
      _count: { select: { attachments: true } },
    },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');
  if (ticket.requestedById !== executorId) {
    throw new TicketError('FORBIDDEN', 'No eres el dueño del ticket');
  }
  if (ticket.status !== 'PENDING_ADMIN_APPROVAL' && ticket.status !== 'AWAITING_QUOTES') {
    throw new TicketError('INVALID_STATE', 'Solo se pueden subir fotos antes de la aprobación final');
  }
  if (ticket._count.attachments >= MAX_ATTACHMENTS) {
    throw new TicketError('BAD_REQUEST', `Máximo ${MAX_ATTACHMENTS} fotos por ticket`);
  }

  return prisma.ticketAttachment.create({
    data: {
      ticketId,
      fileUrl: file.url,
      fileName: file.name,
      mimeType: file.mimeType ?? null,
      sizeBytes: file.sizeBytes ?? null,
    },
  });
}

// ─── ADMIN: rechazar (filtro inicial o final) ──────────────────────
export async function rejectTicket(ticketId: number, adminId: number, rejectionReason: string) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, requestedById: true, vehicleId: true },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');

  let newStatus: MaintenanceTicketStatus;
  if (ticket.status === 'PENDING_ADMIN_APPROVAL') newStatus = 'REJECTED_BY_ADMIN';
  else if (ticket.status === 'AWAITING_QUOTES') newStatus = 'REJECTED_FINAL';
  else throw new TicketError('INVALID_STATE', `No se puede rechazar en estado ${ticket.status}`);

  const updated = await prisma.maintenanceTicket.update({
    where: { id: ticketId },
    data: {
      status: newStatus,
      rejectionReason,
      rejectedAt: new Date(),
      rejectedById: adminId,
    },
  });

  await createNotification({
    userId: ticket.requestedById,
    type: 'MAINTENANCE_TICKET_REJECTED',
    title: 'Tu solicitud de mantenimiento fue rechazada',
    message: rejectionReason.slice(0, 200),
    entityRef: `ticket:${ticket.id}`,
  });

  return updated;
}

// ─── ADMIN: asignar 3 talleres → AWAITING_QUOTES ───────────────────
export async function assignWorkshops(
  ticketId: number,
  _adminId: number,
  input: AssignWorkshopsInput,
) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, vehicleId: true },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');
  if (ticket.status !== 'PENDING_ADMIN_APPROVAL') {
    throw new TicketError('INVALID_STATE', `Talleres solo se asignan en PENDING_ADMIN_APPROVAL (actual: ${ticket.status})`);
  }

  const workshops = await prisma.workshop.findMany({
    where: { id: { in: input.workshopIds }, isActive: true },
    select: { id: true, legalName: true, user: { select: { id: true } } },
  });
  if (workshops.length !== 3) {
    throw new TicketError('BAD_REQUEST', 'Algún taller no existe o está inactivo');
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.ticketQuote.createMany({
      data: input.workshopIds.map((wid) => ({
        ticketId,
        workshopId: wid,
      })),
    });

    return tx.maintenanceTicket.update({
      where: { id: ticketId },
      data: { status: 'AWAITING_QUOTES' },
      include: { quotes: { include: { workshop: { select: { id: true, legalName: true } } } } },
    });
  });

  await Promise.all(
    workshops.map(async (w) => {
      if (!w.user) {
        logger.warn({ workshopId: w.id, ticketId }, 'Workshop sin cuenta de usuario — no se envía notificación');
        return;
      }
      await createNotification({
        userId: w.user.id,
        type: 'MAINTENANCE_QUOTE_REQUESTED',
        title: 'Solicitud de cotización',
        message: `Se te invitó a cotizar el ticket #${ticketId}`,
        entityRef: `ticket:${ticketId}`,
      });
    }),
  );

  return result;
}

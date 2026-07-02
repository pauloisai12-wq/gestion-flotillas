// /api/src/services/tickets/createFlow.ts
// Acciones tempranas del flujo de tickets:
//   - EJECUTOR: crea ticket, sube fotos.
//   - ADMIN: rechaza (filtro inicial) o asigna 1-3 talleres → AWAITING_QUOTES.

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

  // Folio único concurrency-safe: el UPSERT atómico del contador anual
  // (ON CONFLICT DO UPDATE bloquea la fila) corre en la MISMA transacción que la
  // inserción del ticket, así dos creaciones simultáneas nunca obtienen el mismo folio.
  const ticket = await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "maintenance_folio_counters" ("year", "lastValue")
      VALUES (${year}, 1)
      ON CONFLICT ("year")
      DO UPDATE SET "lastValue" = "maintenance_folio_counters"."lastValue" + 1
      RETURNING "lastValue"`;
    const folio = `SM-${year}-${String(rows[0].lastValue).padStart(5, '0')}`;

    return tx.maintenanceTicket.create({
      data: {
        folio,
        vehicleId: input.vehicleId,
        requestedById: executorId,
        failureCategory: input.failureCategory,
        description: input.description,
        reportedOdometer: input.reportedOdometer ?? null,
        odometerStatus: input.odometerStatus,
      },
    });
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

// ─── ADMIN: asignar talleres (1 a 3) → AWAITING_QUOTES ─────────────
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
  // Se aceptan 1-3 talleres (validado en el schema); aquí sólo verificamos que
  // todos los seleccionados existan y estén activos.
  if (workshops.length !== input.workshopIds.length) {
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

// ─── ADMIN: reasignar talleres (cambiar la selección en AWAITING_QUOTES) ──
// A diferencia de assignWorkshops (asignación inicial desde PENDING_ADMIN_APPROVAL),
// esto ajusta el conjunto de talleres cuando el ticket YA está esperando cotizaciones:
// se recibe la lista deseada (1-3) y se sincroniza por diferencia.
//   • Talleres nuevos → se crea su TicketQuote y se les notifica.
//   • Talleres que se quitan → se borra su TicketQuote (se pierde su cotización si
//     ya la habían enviado; es la intención explícita del admin al cambiarlo).
//   • Talleres que se mantienen → intactos (conservan su cotización).
// El estado del ticket NO cambia: sigue en AWAITING_QUOTES.
export async function reassignWorkshops(
  ticketId: number,
  _adminId: number,
  input: AssignWorkshopsInput,
) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      status: true,
      quotes: { select: { id: true, workshopId: true, isWinner: true } },
    },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');
  if (ticket.status !== 'AWAITING_QUOTES') {
    throw new TicketError(
      'INVALID_STATE',
      `Solo se pueden cambiar talleres mientras se esperan cotizaciones (actual: ${ticket.status})`,
    );
  }

  const desiredIds = input.workshopIds;
  const currentIds = ticket.quotes.map((q) => q.workshopId);

  const toAddIds = desiredIds.filter((id) => !currentIds.includes(id));
  const toRemove = ticket.quotes.filter((q) => !desiredIds.includes(q.workshopId));

  // Defensivo: en AWAITING_QUOTES no debería haber ganador, pero nunca borres uno.
  if (toRemove.some((q) => q.isWinner)) {
    throw new TicketError('INVALID_STATE', 'No se puede quitar un taller con cotización ganadora');
  }

  // Sin cambios: no-op idempotente, devolvemos el ticket tal cual.
  if (toAddIds.length === 0 && toRemove.length === 0) {
    return prisma.maintenanceTicket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { quotes: { include: { workshop: { select: { id: true, legalName: true } } } } },
    });
  }

  // Verificar que todos los talleres NUEVOS existan y estén activos.
  const addedWorkshops = await prisma.workshop.findMany({
    where: { id: { in: toAddIds }, isActive: true },
    select: { id: true, legalName: true, user: { select: { id: true } } },
  });
  if (addedWorkshops.length !== toAddIds.length) {
    throw new TicketError('BAD_REQUEST', 'Algún taller no existe o está inactivo');
  }

  const result = await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.ticketQuote.deleteMany({
        where: { ticketId, workshopId: { in: toRemove.map((q) => q.workshopId) } },
      });
    }
    if (toAddIds.length > 0) {
      await tx.ticketQuote.createMany({
        data: toAddIds.map((wid) => ({ ticketId, workshopId: wid })),
      });
    }

    return tx.maintenanceTicket.update({
      where: { id: ticketId },
      data: {}, // toca updatedAt; el estado permanece en AWAITING_QUOTES
      include: { quotes: { include: { workshop: { select: { id: true, legalName: true } } } } },
    });
  });

  // Notificar solo a los talleres recién agregados.
  await Promise.all(
    addedWorkshops.map(async (w) => {
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

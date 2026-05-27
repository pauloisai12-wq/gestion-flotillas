// /api/src/services/maintenanceTicketService.ts
// Lógica del flujo Admin / Ejecutor / Taller para tickets de mantenimiento.
//
// Convenciones:
//   - Cada transición de estado se valida explícitamente contra el status actual.
//   - Las acciones que tocan presupuesto o estado compuesto se hacen en $transaction.
//   - Errores de validación se lanzan como objetos con `code` + `message` para
//     que el router los convierta en 400/403/404 consistentes.

import prisma, { type Tx } from '../lib/prisma';
import {
  MaintenanceTicketStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import {
  CreateTicketInput,
  AssignWorkshopsInput,
  ApproveTicketInput,
  SubmitQuoteInput,
  DeclineQuoteInput,
  CompleteRepairInput,
  ListTicketsQuery,
} from '../validators/maintenanceTicketValidator';
import { createNotification } from './notificationService';
import { logger } from '../lib/logger';

const MAX_ATTACHMENTS = 5;

// ═══════════════════════════════════════════════════════════════
// Errores de dominio — el router los mapea a HTTP
// ═══════════════════════════════════════════════════════════════
export class TicketError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_STATE' | 'BAD_REQUEST' | 'BUDGET_EXCEEDED',
    message: string,
  ) {
    super(message);
  }
}

// ═══════════════════════════════════════════════════════════════
// EJECUTOR: crear ticket
// ═══════════════════════════════════════════════════════════════
export async function createTicket(executorId: number, input: CreateTicketInput) {
  // El vehículo debe existir y el usuario debe ser su ejecutor asignado.
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
      // status default = PENDING_ADMIN_APPROVAL
    },
  });

  // Notificar a los admins de mantenimiento
  await notifyTicketAdmins({
    type: 'MAINTENANCE_TICKET_CREATED',
    title: 'Nuevo ticket de mantenimiento',
    message: `Vehículo ${vehicle.economicNumber} (${vehicle.plate}) — ${input.description.slice(0, 80)}`,
    entityRef: `ticket:${ticket.id}`,
  });

  return ticket;
}

// ═══════════════════════════════════════════════════════════════
// EJECUTOR: subir attachment (foto)
// ═══════════════════════════════════════════════════════════════
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
  // Solo se aceptan fotos mientras el ticket no haya sido procesado
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

// ═══════════════════════════════════════════════════════════════
// ADMIN: rechazar (filtro inicial o final)
// ═══════════════════════════════════════════════════════════════
export async function rejectTicket(ticketId: number, adminId: number, rejectionReason: string) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, requestedById: true, vehicleId: true },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');

  // Solo se puede rechazar antes de aprobar
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

  // Notificar al ejecutor
  await createNotification({
    userId: ticket.requestedById,
    type: 'MAINTENANCE_TICKET_REJECTED',
    title: 'Tu solicitud de mantenimiento fue rechazada',
    message: rejectionReason.slice(0, 200),
    entityRef: `ticket:${ticket.id}`,
  });

  return updated;
}

// ═══════════════════════════════════════════════════════════════
// ADMIN: asignar 3 talleres → AWAITING_QUOTES
// ═══════════════════════════════════════════════════════════════
export async function assignWorkshops(
  ticketId: number,
  adminId: number,
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

  // Validar que los 3 talleres existen y están activos
  const workshops = await prisma.workshop.findMany({
    where: { id: { in: input.workshopIds }, isActive: true },
    select: { id: true, legalName: true, user: { select: { id: true } } },
  });
  if (workshops.length !== 3) {
    throw new TicketError('BAD_REQUEST', 'Algún taller no existe o está inactivo');
  }

  // Transacción: crear 3 quotes en blanco + mover status
  const result = await prisma.$transaction(async (tx) => {
    await tx.ticketQuote.createMany({
      data: input.workshopIds.map((wid) => ({
        ticketId,
        workshopId: wid,
        // amount, pdfUrl, submittedAt todos null hasta que el taller envíe
      })),
    });

    return tx.maintenanceTicket.update({
      where: { id: ticketId },
      data: { status: 'AWAITING_QUOTES' },
      include: { quotes: { include: { workshop: { select: { id: true, legalName: true } } } } },
    });
  });

  // Notificar a las cuentas de los talleres (si tienen una vinculada)
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

// ═══════════════════════════════════════════════════════════════
// TALLER: enviar cotización (amount + PDF)
// ═══════════════════════════════════════════════════════════════
export async function submitQuote(
  quoteId: number,
  workshopUserId: number,
  input: SubmitQuoteInput,
  pdf: { url: string; fileName: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: workshopUserId },
    select: { workshopId: true, role: true },
  });
  if (!user || user.role !== 'WORKSHOP' || !user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Cuenta sin taller vinculado');
  }

  const quote = await prisma.ticketQuote.findUnique({
    where: { id: quoteId },
    include: {
      ticket: { select: { id: true, status: true } },
    },
  });
  if (!quote) throw new TicketError('NOT_FOUND', 'Cotización no existe');
  if (quote.workshopId !== user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Esta cotización no pertenece a tu taller');
  }
  if (quote.ticket.status !== 'AWAITING_QUOTES') {
    throw new TicketError('INVALID_STATE', `El ticket ya no acepta cotizaciones (estado: ${quote.ticket.status})`);
  }
  if (quote.declinedAt) {
    throw new TicketError('INVALID_STATE', 'Ya declinaste esta cotización');
  }

  const updated = await prisma.ticketQuote.update({
    where: { id: quoteId },
    data: {
      amount: new Prisma.Decimal(input.amount),
      pdfUrl: pdf.url,
      pdfFileName: pdf.fileName,
      diagnosisNotes: input.diagnosisNotes ?? null,
      submittedAt: new Date(),
    },
  });

  await notifyTicketAdmins({
    type: 'MAINTENANCE_QUOTE_SUBMITTED',
    title: 'Nueva cotización recibida',
    message: `Ticket #${quote.ticket.id}: cotización por $${input.amount.toFixed(2)}`,
    entityRef: `ticket:${quote.ticket.id}`,
  });

  return updated;
}

// ═══════════════════════════════════════════════════════════════
// TALLER: declinar cotización
// ═══════════════════════════════════════════════════════════════
export async function declineQuote(
  quoteId: number,
  workshopUserId: number,
  input: DeclineQuoteInput,
) {
  const user = await prisma.user.findUnique({
    where: { id: workshopUserId },
    select: { workshopId: true, role: true },
  });
  if (!user || user.role !== 'WORKSHOP' || !user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Cuenta sin taller vinculado');
  }

  const quote = await prisma.ticketQuote.findUnique({
    where: { id: quoteId },
    include: { ticket: { select: { status: true } } },
  });
  if (!quote) throw new TicketError('NOT_FOUND', 'Cotización no existe');
  if (quote.workshopId !== user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Esta cotización no pertenece a tu taller');
  }
  if (quote.ticket.status !== 'AWAITING_QUOTES') {
    throw new TicketError('INVALID_STATE', 'El ticket ya no acepta cambios de cotización');
  }
  if (quote.submittedAt) {
    throw new TicketError('INVALID_STATE', 'No puedes declinar una cotización ya enviada');
  }

  return prisma.ticketQuote.update({
    where: { id: quoteId },
    data: {
      declinedAt: new Date(),
      declineReason: input.declineReason,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// ADMIN: aprobar cotización ganadora → APPROVED_FOR_REPAIR
// Transacción: reserva presupuesto, marca quote ganadora, actualiza ticket.
// ═══════════════════════════════════════════════════════════════
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

  // ─── Transacción atómica ─────────────────────────────────────
  const result = await prisma.$transaction(async (tx) => {
    // Reservar presupuesto de mantenimiento del mes en curso
    const budgetResult = await reserveMaintenanceBudget(tx, ticket.vehicleId, amount);
    if (!budgetResult.allowed) {
      throw new TicketError(
        'BUDGET_EXCEEDED',
        budgetResult.available !== null
          ? `Excede presupuesto: disponible $${budgetResult.available.toFixed(2)}, requerido $${amount.toFixed(2)}`
          : 'Sin presupuesto asignado para mantenimiento este mes',
      );
    }

    // Marcar la quote como ganadora
    await tx.ticketQuote.update({
      where: { id: winningQuote.id },
      data: { isWinner: true },
    });

    // Actualizar el ticket
    return tx.maintenanceTicket.update({
      where: { id: ticketId },
      data: {
        status: 'APPROVED_FOR_REPAIR',
        finalConcept: input.finalConcept,
        selectedQuoteId: winningQuote.id,
        approvedByAdminId: adminId,
        approvedAt: new Date(),
      },
      include: { selectedQuote: { include: { workshop: true } } },
    });
  });

  // Notificaciones (fuera de la transacción para no extenderla)
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

// ═══════════════════════════════════════════════════════════════
// TALLER GANADOR: marcar inicio de reparación → IN_REPAIR
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// TALLER GANADOR: completar reparación → COMPLETED
// Crea MaintenanceRecord en transacción.
// ═══════════════════════════════════════════════════════════════
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

  // Validar que el serviceId existe y aplica al tipo de vehículo
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
    // Crear el MaintenanceRecord con datos del ticket + cotización ganadora
    const record = await tx.maintenanceRecord.create({
      data: {
        vehicleId: ticket.vehicleId,
        serviceId: input.serviceId,
        workshopId: ticket.selectedQuote!.workshopId,
        cost: ticket.selectedQuote!.amount!,
        odometer: input.finalOdometer ?? null,
        odometerStatus: input.finalOdometerStatus,
        serviceDate: now,
        notes: input.evidenceNotes ?? ticket.finalConcept ?? null,
      },
    });

    // Cerrar el ticket
    return tx.maintenanceTicket.update({
      where: { id: ticketId },
      data: {
        status: 'COMPLETED',
        repairCompletedAt: now,
        completedRecordId: record.id,
      },
    });
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

// ═══════════════════════════════════════════════════════════════
// LECTURA: obtener detalle (con RBAC)
// ═══════════════════════════════════════════════════════════════
export async function getTicketById(ticketId: number, user: { userId: number; role: UserRole }) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    include: {
      vehicle: { select: { id: true, economicNumber: true, plate: true, brand: true, model: true, year: true } },
      requestedBy: { select: { id: true, fullName: true, email: true } },
      rejectedBy: { select: { id: true, fullName: true } },
      approvedByAdmin: { select: { id: true, fullName: true } },
      attachments: true,
      quotes: {
        include: {
          workshop: { select: { id: true, legalName: true, tradeName: true } },
        },
        orderBy: { id: 'asc' },
      },
      selectedQuote: true,
      completedRecord: true,
    },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');

  // RBAC: filtros por rol
  if (user.role === 'EXECUTOR') {
    if (ticket.requestedById !== user.userId) {
      throw new TicketError('FORBIDDEN', 'No puedes ver tickets que no levantaste');
    }
    // El ejecutor ve el estado de su solicitud, no los precios ni PDFs de los talleres.
    ticket.quotes = [];
    ticket.selectedQuote = null;
  }
  if (user.role === 'WORKSHOP') {
    const workshopUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { workshopId: true },
    });
    if (!workshopUser?.workshopId) throw new TicketError('FORBIDDEN', 'Cuenta sin taller');
    const myWorkshopId = workshopUser.workshopId;
    const isParticipant = ticket.quotes.some((q) => q.workshopId === myWorkshopId);
    if (!isParticipant) {
      throw new TicketError('FORBIDDEN', 'Tu taller no participa en este ticket');
    }
    // Un taller solo puede ver SU propia cotización, nunca las de los demás talleres.
    ticket.quotes = ticket.quotes.filter((q) => q.workshopId === myWorkshopId);
    // Tampoco revelamos la cotización ganadora si pertenece a otro taller.
    if (ticket.selectedQuote && ticket.selectedQuote.workshopId !== myWorkshopId) {
      ticket.selectedQuote = null;
    }
  }
  // ADMIN, SUP_MAINT, SUP_VEHICLES, SUP_FUEL pueden ver todo (los supervisores son lectores)

  return ticket;
}

// ═══════════════════════════════════════════════════════════════
// LECTURA: listar tickets con filtros (RBAC)
// ═══════════════════════════════════════════════════════════════
export async function listTickets(
  user: { userId: number; role: UserRole },
  query: ListTicketsQuery,
) {
  const where: Prisma.MaintenanceTicketWhereInput = {};

  if (query.status) where.status = query.status;
  if (query.vehicleId) where.vehicleId = query.vehicleId;

  // Filtro por rol
  if (user.role === 'EXECUTOR') {
    where.requestedById = user.userId;
  } else if (user.role === 'WORKSHOP') {
    const workshopUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { workshopId: true },
    });
    if (!workshopUser?.workshopId) return { tickets: [], total: 0, page: query.page, limit: query.limit };
    where.quotes = { some: { workshopId: workshopUser.workshopId } };
  }
  // Admins/supervisores ven todo

  const [tickets, total] = await Promise.all([
    prisma.maintenanceTicket.findMany({
      where,
      include: {
        vehicle: { select: { id: true, economicNumber: true, plate: true } },
        requestedBy: { select: { id: true, fullName: true } },
        quotes: {
          select: { id: true, workshopId: true, amount: true, submittedAt: true, declinedAt: true, isWinner: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.maintenanceTicket.count({ where }),
  ]);

  return { tickets, total, page: query.page, limit: query.limit };
}

// ═══════════════════════════════════════════════════════════════
// LECTURA: contexto de presupuesto para la decisión del admin
// ═══════════════════════════════════════════════════════════════
export async function getBudgetContext(ticketId: number) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      vehicleId: true,
      vehicle: { select: { economicNumber: true, plate: true } },
      quotes: {
        select: { id: true, workshopId: true, workshop: { select: { legalName: true } }, amount: true, submittedAt: true, declinedAt: true },
      },
    },
  });
  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');

  const now = new Date();
  const budget = await prisma.vehicleBudget.findUnique({
    where: {
      vehicleId_kind_year_month: {
        vehicleId: ticket.vehicleId,
        kind: 'MAINTENANCE',
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      },
    },
  });

  const available = budget
    ? Number(budget.baseAmount) + Number(budget.rolloverIn) - Number(budget.spentAmount)
    : 0;

  return {
    ticket: { id: ticket.id, vehicle: ticket.vehicle },
    budget: budget
      ? {
          baseAmount: Number(budget.baseAmount),
          rolloverIn: Number(budget.rolloverIn),
          spentAmount: Number(budget.spentAmount),
          available,
          isCutOff: budget.isCutOff,
        }
      : null,
    quotes: ticket.quotes.map((q) => ({
      id: q.id,
      workshop: q.workshop.legalName,
      amount: q.amount ? Number(q.amount) : null,
      status: q.declinedAt ? 'DECLINED' : q.submittedAt ? 'SUBMITTED' : 'PENDING',
      fits: q.amount ? Number(q.amount) <= available : null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers internos
// ═══════════════════════════════════════════════════════════════

/// Carga un ticket y valida que el usuario sea del taller ganador.
async function loadTicketForWinningWorkshop(ticketId: number, workshopUserId: number) {
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

/// Reserva monto del presupuesto de mantenimiento del vehículo en el mes en curso.
/// Misma lógica que checkAndReserveFuelBudget de budgetService pero para MAINTENANCE.
async function reserveMaintenanceBudget(tx: Tx, vehicleId: number, amount: number) {
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

  await tx.vehicleBudget.update({
    where: { id: b.id },
    data: {
      spentAmount: { increment: amount },
      isCutOff: amount === available ? true : undefined,
    },
  });

  return { allowed: true, available: available - amount };
}

/// Notifica a todos los admins de mantenimiento (ADMIN + SUPERVISOR_MAINTENANCE).
async function notifyTicketAdmins(params: {
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

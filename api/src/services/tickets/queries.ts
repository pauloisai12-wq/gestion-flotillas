// /api/src/services/tickets/queries.ts
// Lecturas con RBAC: detalle, listado paginado y contexto de presupuesto.

import prisma from '../../lib/prisma';
import { Prisma, UserRole } from '@prisma/client';
import { ListTicketsQuery, SearchTicketsQuery } from '../../validators/maintenanceTicketValidator';
import { TicketError } from './shared';

// ─── Detalle de un ticket (filtrado por rol del consultante) ───────
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

  // RBAC: el ejecutor sólo ve sus tickets, sin precios ni PDFs.
  if (user.role === 'EXECUTOR') {
    if (ticket.requestedById !== user.userId) {
      throw new TicketError('FORBIDDEN', 'No puedes ver tickets que no levantaste');
    }
    ticket.quotes = [];
    ticket.selectedQuote = null;
  }
  // El taller sólo ve su propia cotización; no ve la de los demás talleres.
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
    ticket.quotes = ticket.quotes.filter((q) => q.workshopId === myWorkshopId);
    if (ticket.selectedQuote && ticket.selectedQuote.workshopId !== myWorkshopId) {
      ticket.selectedQuote = null;
    }
  }
  // ADMIN y supervisores ven todo.

  return ticket;
}

// ─── Listado paginado con RBAC ─────────────────────────────────────
export async function listTickets(
  user: { userId: number; role: UserRole },
  query: ListTicketsQuery,
) {
  const where: Prisma.MaintenanceTicketWhereInput = {};

  if (query.status) where.status = query.status;
  if (query.vehicleId) where.vehicleId = query.vehicleId;

  if (user.role === 'EXECUTOR') {
    where.requestedById = user.userId;
  } else if (user.role === 'WORKSHOP') {
    const workshopUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { workshopId: true },
    });
    if (!workshopUser?.workshopId) {
      return { tickets: [], total: 0, page: query.page, limit: query.limit };
    }
    where.quotes = { some: { workshopId: workshopUser.workshopId } };
  }
  // Admins/supervisores ven todo.

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

// ─── Contexto de presupuesto para la decisión del admin ────────────
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

// ─── Datos para el PDF de la solicitud (con RBAC) ──────────────────
// No incluye precios/cotizaciones → seguro para que el ejecutor dueño lo vea.
export async function getSolicitudData(
  ticketId: number,
  user: { userId: number; role: UserRole },
) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      folio: true,
      description: true,
      failureCategory: true,
      status: true,
      reportedOdometer: true,
      odometerStatus: true,
      createdAt: true,
      approvedAt: true,
      requestedById: true,
      vehicle: {
        select: {
          economicNumber: true,
          civ: true,
          plate: true,
          vin: true,
          brand: true,
          model: true,
          year: true,
        },
      },
      requestedBy: { select: { fullName: true, role: true } },
      approvedByAdmin: { select: { fullName: true, role: true } },
    },
  });

  if (!ticket) throw new TicketError('NOT_FOUND', 'Ticket no existe');

  // El ejecutor sólo puede descargar el PDF de las solicitudes que él levantó.
  if (user.role === 'EXECUTOR' && ticket.requestedById !== user.userId) {
    throw new TicketError('FORBIDDEN', 'No puedes ver solicitudes que no levantaste');
  }

  return ticket;
}

export type SolicitudData = Awaited<ReturnType<typeof getSolicitudData>>;

// ─── Búsqueda del revisor (CIV / placa / serie / folio) ────────────
// Coincidencia: folio y CIV exactos (insensible); placa y serie parciales (ILIKE).
// RBAC: el gating por rol se hace en la ruta (MAINT_MANAGERS).
export async function searchTickets(query: SearchTicketsQuery) {
  const vehicleWhere: Prisma.VehicleWhereInput = {};
  if (query.civ) vehicleWhere.civ = { equals: query.civ, mode: 'insensitive' };
  if (query.placa) vehicleWhere.plate = { contains: query.placa, mode: 'insensitive' };
  if (query.serie) vehicleWhere.vin = { contains: query.serie, mode: 'insensitive' };

  const where: Prisma.MaintenanceTicketWhereInput = {};
  if (query.folio) where.folio = { equals: query.folio, mode: 'insensitive' };
  if (Object.keys(vehicleWhere).length > 0) where.vehicle = { is: vehicleWhere };

  const [tickets, total] = await Promise.all([
    prisma.maintenanceTicket.findMany({
      where,
      select: {
        id: true,
        folio: true,
        status: true,
        createdAt: true,
        vehicle: {
          select: {
            id: true,
            economicNumber: true,
            plate: true,
            vin: true,
            civ: true,
            brand: true,
            model: true,
            year: true,
          },
        },
        requestedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.maintenanceTicket.count({ where }),
  ]);

  return { tickets, total, page: query.page, limit: query.limit };
}

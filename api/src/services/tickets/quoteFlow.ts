// /api/src/services/tickets/quoteFlow.ts
// Acciones del TALLER sobre cotizaciones: enviar amount+PDF o declinar.

import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import {
  SubmitQuoteInput,
  DeclineQuoteInput,
} from '../../validators/maintenanceTicketValidator';
import { TicketError, notifyTicketAdmins } from './shared';

// ─── TALLER: enviar cotización (amount + PDF) ─────────────────────
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

// ─── TALLER: declinar cotización ──────────────────────────────────
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

import path from 'node:path';
import type { UserRole } from '@prisma/client';
import prisma from '../../lib/prisma';
import { UPLOAD_DIRS } from '../../lib/uploadStorage';
import { TicketError } from './shared';

export type TicketFileViewer = {
  userId: number;
  role: UserRole;
};

type StoredAttachment = {
  id: number;
  ticketId: number;
  fileUrl: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: Date;
};

type StoredQuote = {
  id: number;
  pdfUrl: string | null;
};

const INTERNAL_EVIDENCE_READERS = new Set<UserRole>([
  'ADMIN',
  'SUPERVISOR_VEHICLES',
  'SUPERVISOR_MAINTENANCE',
]);

const INTERNAL_QUOTE_READERS = new Set<UserRole>([
  'ADMIN',
  'SUPERVISOR_MAINTENANCE',
]);

function fileInside(directory: string, storedUrl: string): string {
  const baseDir = path.resolve(directory);
  const fileName = path.basename(storedUrl.replace(/\\/g, '/'));
  if (!fileName || fileName === '.' || fileName === '..') {
    throw new TicketError('NOT_FOUND', 'Archivo no disponible');
  }

  const filePath = path.resolve(baseDir, fileName);
  if (!filePath.startsWith(`${baseDir}${path.sep}`)) {
    throw new TicketError('NOT_FOUND', 'Archivo no disponible');
  }
  return filePath;
}

async function workshopIdFor(viewer: TicketFileViewer): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: viewer.userId },
    select: { workshopId: true, role: true },
  });
  if (!user || user.role !== 'WORKSHOP' || !user.workshopId) {
    throw new TicketError('FORBIDDEN', 'Cuenta sin taller vinculado');
  }
  return user.workshopId;
}

/**
 * Resuelve una evidencia solo después de validar la misma política que el
 * detalle del ticket: dueño ejecutor, taller participante o lector interno.
 */
export async function getTicketAttachmentFile(
  ticketId: number,
  attachmentId: number,
  viewer: TicketFileViewer,
) {
  const attachment = await prisma.ticketAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      ticketId: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedAt: true,
      ticket: {
        select: {
          requestedById: true,
          quotes: { select: { workshopId: true } },
        },
      },
    },
  });

  // Un ID de adjunto válido bajo otro ticket no se revela al solicitante.
  if (!attachment || attachment.ticketId !== ticketId) {
    throw new TicketError('NOT_FOUND', 'Evidencia no existe');
  }

  if (viewer.role === 'EXECUTOR') {
    if (attachment.ticket.requestedById !== viewer.userId) {
      throw new TicketError('FORBIDDEN', 'No puedes ver evidencias de tickets que no levantaste');
    }
  } else if (viewer.role === 'WORKSHOP') {
    const workshopId = await workshopIdFor(viewer);
    if (!attachment.ticket.quotes.some((quote) => quote.workshopId === workshopId)) {
      throw new TicketError('FORBIDDEN', 'Tu taller no participa en este ticket');
    }
  } else if (!INTERNAL_EVIDENCE_READERS.has(viewer.role)) {
    throw new TicketError('FORBIDDEN', 'Tu rol no puede ver evidencias de mantenimiento');
  }

  return {
    filePath: fileInside(UPLOAD_DIRS.maintenanceTicketPhotos, attachment.fileUrl),
    thumbnailPath: path.join(
      UPLOAD_DIRS.maintenanceTicketThumbnails,
      `${path.parse(path.basename(attachment.fileUrl)).name}.webp`,
    ),
    fileName: attachment.fileName,
    contentType: imageContentType(attachment.fileUrl),
  };
}

/**
 * Las cotizaciones no son visibles para ejecutores. Los responsables internos
 * pueden auditarlas y cada taller únicamente descarga su propia cotización.
 */
export async function getTicketQuoteFile(quoteId: number, viewer: TicketFileViewer) {
  const quote = await prisma.ticketQuote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      workshopId: true,
      pdfUrl: true,
      pdfFileName: true,
    },
  });

  if (!quote || !quote.pdfUrl) {
    throw new TicketError('NOT_FOUND', 'Cotización no disponible');
  }
  if (viewer.role === 'EXECUTOR') {
    throw new TicketError('FORBIDDEN', 'Los ejecutores no pueden ver cotizaciones');
  }
  if (viewer.role === 'WORKSHOP') {
    if (quote.workshopId !== await workshopIdFor(viewer)) {
      throw new TicketError('FORBIDDEN', 'Esta cotización no pertenece a tu taller');
    }
  } else if (!INTERNAL_QUOTE_READERS.has(viewer.role)) {
    throw new TicketError('FORBIDDEN', 'Tu rol no puede ver cotizaciones de mantenimiento');
  }

  return {
    filePath: fileInside(UPLOAD_DIRS.maintenanceTicketQuotes, quote.pdfUrl),
    fileName: quote.pdfFileName ?? `cotizacion-${quote.id}.pdf`,
  };
}

function imageContentType(storedUrl: string): 'image/jpeg' | 'image/png' {
  return path.extname(storedUrl).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
}

export function attachmentFileUrl(ticketId: number, attachmentId: number): string {
  return `/api/maintenance-tickets/${ticketId}/attachments/${attachmentId}/file`;
}

export function attachmentThumbnailFileUrl(ticketId: number, attachmentId: number): string {
  return `/api/maintenance-tickets/${ticketId}/attachments/${attachmentId}/thumbnail`;
}

export function quoteFileUrl(quoteId: number): string {
  return `/api/ticket-quotes/${quoteId}/pdf`;
}

export function serializeTicketAttachment<T extends StoredAttachment>(attachment: T) {
  return {
    ...attachment,
    fileUrl: attachmentFileUrl(attachment.ticketId, attachment.id),
    thumbnailUrl: attachmentThumbnailFileUrl(attachment.ticketId, attachment.id),
  };
}

export function serializeTicketQuote<T extends StoredQuote>(quote: T) {
  return {
    ...quote,
    pdfUrl: quote.pdfUrl ? quoteFileUrl(quote.id) : null,
  };
}

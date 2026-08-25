import { promises as fs } from 'node:fs';
import path from 'node:path';
import express, { type Response } from 'express';
import request from 'supertest';
import type { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  attachmentFindUnique: vi.fn(),
  quoteFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  sendPrivateFile: vi.fn(),
  enqueueTicketThumbnail: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({
  default: {
    ticketAttachment: { findUnique: mocks.attachmentFindUnique },
    ticketQuote: { findUnique: mocks.quoteFindUnique },
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock('../../src/lib/privateFileResponse', () => ({
  sendPrivateFile: mocks.sendPrivateFile,
}));

vi.mock('../../src/services/mediaThumbnailService', () => ({
  enqueueTicketThumbnail: mocks.enqueueTicketThumbnail,
}));

vi.mock('../../src/services/tickets/solicitudPdf', () => ({
  renderSolicitudPdf: vi.fn(),
}));

import {
  attachmentFileUrl,
  attachmentThumbnailFileUrl,
  getTicketAttachmentFile,
  getTicketQuoteFile,
  quoteFileUrl,
  serializeTicketAttachment,
  serializeTicketQuote,
} from '../../src/services/tickets/fileAccess';
import maintenanceTicketRouter from '../../src/routes/maintenanceTicketRouter';
import ticketQuoteRouter from '../../src/routes/ticketQuoteRouter';

const attachment = {
  id: 9,
  ticketId: 41,
  fileUrl: '/uploads/maintenance-tickets/photos/photo-uuid.jpg',
  fileName: 'motor.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1234,
  uploadedAt: new Date('2026-07-15T00:00:00.000Z'),
  ticket: {
    requestedById: 101,
    quotes: [{ workshopId: 501 }],
  },
};

const quote = {
  id: 77,
  workshopId: 501,
  pdfUrl: '/uploads/maintenance-tickets/quotes/quote-uuid.pdf',
  pdfFileName: 'cotizacion.pdf',
};

function createApp(user?: { userId: number; role: UserRole }) {
  const app = express();
  app.use((req, _res, next) => {
    if (user) req.user = { ...user, email: 'security-test@example.com' };
    next();
  });
  app.use('/maintenance-tickets', maintenanceTicketRouter);
  app.use('/ticket-quotes', ticketQuoteRouter);
  return app;
}

describe('archivos privados de tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attachmentFindUnique.mockResolvedValue(attachment);
    mocks.quoteFindUnique.mockResolvedValue(quote);
    mocks.sendPrivateFile.mockImplementation(async (_req: unknown, res: Response) => {
      res.status(200).end();
      return true;
    });
  });

  it('permite al ejecutor dueño resolver su evidencia', async () => {
    const result = await getTicketAttachmentFile(41, 9, {
      userId: 101,
      role: 'EXECUTOR',
    });

    expect(path.basename(result.filePath)).toBe('photo-uuid.jpg');
    expect(path.basename(result.thumbnailPath)).toBe('photo-uuid.webp');
    expect(result.contentType).toBe('image/jpeg');
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it('bloquea a un ejecutor que cambia el ID para leer evidencia ajena', async () => {
    await expect(getTicketAttachmentFile(41, 9, {
      userId: 202,
      role: 'EXECUTOR',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bloquea evidencia a un taller no participante', async () => {
    mocks.userFindUnique.mockResolvedValue({ role: 'WORKSHOP', workshopId: 999 });

    await expect(getTicketAttachmentFile(41, 9, {
      userId: 303,
      role: 'WORKSHOP',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bloquea la cotización de otro taller aunque conozca su ID', async () => {
    mocks.userFindUnique.mockResolvedValue({ role: 'WORKSHOP', workshopId: 999 });

    await expect(getTicketQuoteFile(77, {
      userId: 303,
      role: 'WORKSHOP',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('un ejecutor no puede leer PDFs de cotizaciones, ni siquiera de su ticket', async () => {
    await expect(getTicketQuoteFile(77, {
      userId: 101,
      role: 'EXECUTOR',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it('el service niega por defecto a un supervisor interno fuera del dominio', async () => {
    await expect(getTicketAttachmentFile(41, 9, {
      userId: 404,
      role: 'SUPERVISOR_FUEL',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(getTicketQuoteFile(77, {
      userId: 404,
      role: 'SUPERVISOR_FUEL',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('los endpoints rechazan BOLA cross-executor y cross-workshop antes del stream', async () => {
    const executorResponse = await request(createApp({ userId: 202, role: 'EXECUTOR' }))
      .get('/maintenance-tickets/41/attachments/9/file');
    expect(executorResponse.status).toBe(403);

    mocks.userFindUnique.mockResolvedValue({ role: 'WORKSHOP', workshopId: 999 });
    const workshopResponse = await request(createApp({ userId: 303, role: 'WORKSHOP' }))
      .get('/ticket-quotes/77/pdf');
    expect(workshopResponse.status).toBe(403);
    expect(mocks.sendPrivateFile).not.toHaveBeenCalled();
  });

  it('GET y HEAD rechazan a SUPERVISOR_FUEL antes de resolver o transmitir archivos', async () => {
    const app = createApp({ userId: 404, role: 'SUPERVISOR_FUEL' });

    const responses = [
      await request(app).get('/maintenance-tickets/41/attachments/9/file'),
      await request(app).head('/maintenance-tickets/41/attachments/9/file'),
      await request(app).get('/ticket-quotes/77/pdf'),
      await request(app).head('/ticket-quotes/77/pdf'),
    ];

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.attachmentFindUnique).not.toHaveBeenCalled();
    expect(mocks.quoteFindUnique).not.toHaveBeenCalled();
    expect(mocks.sendPrivateFile).not.toHaveBeenCalled();
  });

  it('el endpoint exige autenticación y un responsable interno sí puede transmitir', async () => {
    const anonymous = await request(createApp())
      .get('/maintenance-tickets/41/attachments/9/file');
    expect(anonymous.status).toBe(401);

    const admin = await request(createApp({ userId: 1, role: 'ADMIN' }))
      .get('/ticket-quotes/77/pdf');
    expect(admin.status).toBe(200);
    expect(mocks.sendPrivateFile).toHaveBeenCalledTimes(1);
  });

  it('no revela si el adjunto pertenece a otro ticket', async () => {
    await expect(getTicketAttachmentFile(999, 9, {
      userId: 101,
      role: 'EXECUTOR',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('serializa únicamente endpoints privados y no rutas físicas de uploads', () => {
    expect(attachmentFileUrl(41, 9)).toBe(
      '/api/maintenance-tickets/41/attachments/9/file',
    );
    expect(attachmentThumbnailFileUrl(41, 9)).toBe(
      '/api/maintenance-tickets/41/attachments/9/thumbnail',
    );
    expect(quoteFileUrl(77)).toBe('/api/ticket-quotes/77/pdf');
    expect(serializeTicketAttachment(attachment).fileUrl).not.toContain('/uploads/');
    expect(serializeTicketQuote(quote).pdfUrl).not.toContain('/uploads/');
  });

  it('las rutas GET/HEAD usan el stream privado y el estático queda cerrado', async () => {
    const [indexSource, ticketSource, quoteSource] = await Promise.all([
      fs.readFile(path.resolve('src/index.ts'), 'utf8'),
      fs.readFile(path.resolve('src/routes/maintenanceTicketRouter.ts'), 'utf8'),
      fs.readFile(path.resolve('src/routes/ticketQuoteRouter.ts'), 'utf8'),
    ]);

    expect(indexSource).toContain("'/uploads/maintenance-tickets'");
    // Sin el `if (`: el guard trata en la MISMA condición otras categorías
    // igual de cerradas (encuestas-audio), así que anclar la línea entera
    // rompería este test cada vez que se cierra una categoría nueva.
    expect(indexSource).toContain("uploadCategory === 'maintenance-tickets'");
    expect(ticketSource).toContain("'/:id/attachments/:attachmentId/file'");
    expect(ticketSource).toContain("'/:id/attachments/:attachmentId/thumbnail'");
    expect(quoteSource).toContain("'/:id/pdf'");
    expect(ticketSource).toContain('getTicketAttachmentFile');
    expect(quoteSource).toContain('getTicketQuoteFile');
    expect(ticketSource).toContain('sendPrivateFile');
    expect(quoteSource).toContain('sendPrivateFile');
  });
});

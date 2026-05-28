// /api/src/routes/ticketQuoteRouter.ts
// Endpoints para que los talleres operen sus cotizaciones.
//
// Montado en /api/ticket-quotes (ver index.ts).

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { RoleGroups, requireRole } from '../middlewares/roleMiddleware';
import * as ticketService from '../services/maintenanceTicketService';
import { TicketError } from '../services/maintenanceTicketService';
import { submitQuoteSchema, declineQuoteSchema } from '../validators/maintenanceTicketValidator';
import prisma from '../lib/prisma';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// Upload setup — PDFs de cotización (10MB, solo PDF)
// ═══════════════════════════════════════════════════════════════
const pdfStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/maintenance-tickets/quotes'));
  },
  filename: (_req, file, cb) => {
    // Renombrado seguro con UUID; el filtro de abajo ya garantiza extensión .pdf.
    cb(null, `${crypto.randomUUID()}.pdf`);
  },
});

const pdfUpload = multer({
  storage: pdfStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.pdf') return cb(null, true);
    cb(new Error('La cotización debe ser un archivo PDF'));
  },
});

function parseIdParam(req: Request, res: Response, param = 'id'): number | null {
  const id = parseInt(req.params[param], 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'ID inválido' });
    return null;
  }
  return id;
}

function handleTicketError(err: unknown, res: Response, next?: NextFunction) {
  if (err instanceof TicketError) {
    const statusMap: Record<TicketError['code'], number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      INVALID_STATE: 409,
      BAD_REQUEST: 400,
      BUDGET_EXCEEDED: 422,
    };
    return res.status(statusMap[err.code]).json({ error: err.message, code: err.code });
  }
  if (next) return next(err);
  return res.status(500).json({ error: 'Error interno' });
}

// ═══════════════════════════════════════════════════════════════
// TALLER — listar mis cotizaciones (pendientes y resueltas)
// ═══════════════════════════════════════════════════════════════
router.get(
  '/mine',
  requireRole(RoleGroups.WORKSHOP_ONLY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { workshopId: true },
      });
      if (!user?.workshopId) return res.json({ quotes: [] });

      const quotes = await prisma.ticketQuote.findMany({
        where: { workshopId: user.workshopId },
        include: {
          ticket: {
            select: {
              id: true,
              status: true,
              description: true,
              failureCategory: true,
              createdAt: true,
              vehicle: { select: { economicNumber: true, plate: true, brand: true, model: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ quotes });
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// TALLER — enviar cotización (monto + PDF)
// ═══════════════════════════════════════════════════════════════
router.post(
  '/:id/submit',
  requireRole(RoleGroups.WORKSHOP_ONLY),
  pdfUpload.single('pdf'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req, res);
      if (id === null) return;
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo PDF en campo "pdf"' });

      const parsed = submitQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
      }

      const quote = await ticketService.submitQuote(
        id,
        req.user!.userId,
        parsed.data,
        {
          url: `/uploads/maintenance-tickets/quotes/${req.file.filename}`,
          fileName: req.file.originalname,
        },
      );
      res.json(quote);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// TALLER — declinar cotización
// ═══════════════════════════════════════════════════════════════
router.post(
  '/:id/decline',
  requireRole(RoleGroups.WORKSHOP_ONLY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseIdParam(req, res);
      if (id === null) return;
      const parsed = declineQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
      }
      const quote = await ticketService.declineQuote(id, req.user!.userId, parsed.data);
      res.json(quote);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

export default router;

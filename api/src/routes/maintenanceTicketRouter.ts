// Endpoints del flujo de tickets de mantenimiento.
//
// Montado en /api/maintenance-tickets (ver index.ts).
// Auth: todos requieren JWT (authMiddleware aplicado en index.ts).
// RBAC: por endpoint según el flujo Admin/Ejecutor/Taller.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { RoleGroups, Roles, requireRole } from '../middlewares/roleMiddleware';
import * as ticketService from '../services/maintenanceTicketService';
import { TicketError } from '../services/maintenanceTicketService';
import {
  createTicketSchema,
  rejectTicketSchema,
  assignWorkshopsSchema,
  approveTicketSchema,
  completeRepairSchema,
  listTicketsQuerySchema,
  searchTicketsQuerySchema,
  CreateTicketInput,
  RejectTicketInput,
  AssignWorkshopsInput,
  ApproveTicketInput,
  CompleteRepairInput,
  ListTicketsQuery,
  SearchTicketsQuery,
} from '../validators/maintenanceTicketValidator';
import { validateBody, validateQuery } from '../middlewares/validate';
import { renderSolicitudPdf } from '../services/tickets/solicitudPdf';
import { parseId } from '../lib/http';
import { sendPrivateFile } from '../lib/privateFileResponse';
import {
  cleanupUploadedFilesOnError,
  removeUploadedFiles,
  UPLOAD_DIRS,
  uploadRateLimit,
} from '../lib/uploadStorage';
import { enqueueTicketThumbnail } from '../services/mediaThumbnailService';
import {
  getTicketAttachmentFile,
  serializeTicketAttachment,
  serializeTicketQuote,
} from '../services/tickets/fileAccess';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// Upload setup — fotos del ejecutor (5MB, JPG/PNG)
// ═══════════════════════════════════════════════════════════════
const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIRS.maintenanceTicketPhotos);
  },
  filename: (_req, file, cb) => {
    // Renombrado seguro con UUID; la extensión la valida fileFilter abajo.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const photoUpload = multer({
  storage: photoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes JPG o PNG'));
  },
});

// ═══════════════════════════════════════════════════════════════
// Helper: manejo uniforme de errores de dominio
// ═══════════════════════════════════════════════════════════════
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
  // Para errores inesperados, dejar que el errorHandler global los procese
  if (next) return next(err);
  return res.status(500).json({ error: 'Error interno' });
}

async function serveTicketAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
  thumbnail: boolean,
) {
  try {
    const ticketId = parseId(req);
    const attachmentId = parseId(req, 'attachmentId');
    const file = await getTicketAttachmentFile(ticketId, attachmentId, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
    const sent = await sendPrivateFile(
      req,
      res,
      thumbnail ? file.thumbnailPath : file.filePath,
      {
        contentType: thumbnail ? 'image/webp' : file.contentType,
        cacheControl: 'private, max-age=3600, must-revalidate',
        varyCookie: true,
      },
    );
    if (sent) return;

    if (thumbnail) {
      await enqueueTicketThumbnail(path.basename(file.filePath));
      res.setHeader('Retry-After', '3');
      res.status(404).json({ error: 'Miniatura en proceso', code: 'THUMBNAIL_PENDING' });
      return;
    }
    res.status(404).json({ error: 'Evidencia no encontrada', code: 'NOT_FOUND' });
  } catch (err) {
    handleTicketError(err, res, next);
  }
}

// ═══════════════════════════════════════════════════════════════
// LECTURA — listar y ver detalle (RBAC aplicado en el service)
// ═══════════════════════════════════════════════════════════════

router.get(
  '/',
  requireRole([...RoleGroups.ANY_AUTH, 'WORKSHOP']),
  validateQuery(listTicketsQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await ticketService.listTickets(
        { userId: req.user!.userId, role: req.user!.role },
        req.query as unknown as ListTicketsQuery,
      );
      res.json(result);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// Búsqueda del revisor (ADMIN / SUP_MAINT) por CIV / placa / serie / folio.
// IMPORTANTE: debe ir ANTES de '/:id' o Express captura 'search' como :id.
router.get(
  '/search',
  requireRole(RoleGroups.MAINT_MANAGERS),
  validateQuery(searchTicketsQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await ticketService.searchTickets(req.query as unknown as SearchTicketsQuery);
      res.json(result);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// Evidencias privadas. El service aplica ownership/participación sobre el
// ticket antes de abrir el archivo; /uploads/maintenance-tickets está cerrado.
router.head(
  '/:id/attachments/:attachmentId/file',
  requireRole([...RoleGroups.MAINTENANCE_READERS, Roles.EXECUTOR, Roles.WORKSHOP]),
  (req, res, next) => serveTicketAttachment(req, res, next, false),
);
router.get(
  '/:id/attachments/:attachmentId/file',
  requireRole([...RoleGroups.MAINTENANCE_READERS, Roles.EXECUTOR, Roles.WORKSHOP]),
  (req, res, next) => serveTicketAttachment(req, res, next, false),
);
router.head(
  '/:id/attachments/:attachmentId/thumbnail',
  requireRole([...RoleGroups.MAINTENANCE_READERS, Roles.EXECUTOR, Roles.WORKSHOP]),
  (req, res, next) => serveTicketAttachment(req, res, next, true),
);
router.get(
  '/:id/attachments/:attachmentId/thumbnail',
  requireRole([...RoleGroups.MAINTENANCE_READERS, Roles.EXECUTOR, Roles.WORKSHOP]),
  (req, res, next) => serveTicketAttachment(req, res, next, true),
);

router.get(
  '/:id',
  requireRole([...RoleGroups.ANY_AUTH, 'WORKSHOP']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ticket = await ticketService.getTicketById(id, {
        userId: req.user!.userId,
        role: req.user!.role,
      });
      res.json(ticket);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// PDF de la solicitud (on-demand, refleja el estatus actual). Visible para
// ADMIN/SUP_MAINT y el ejecutor dueño (el service aplica el RBAC del ejecutor).
router.get(
  '/:id/solicitud.pdf',
  requireRole([...RoleGroups.MAINT_MANAGERS, 'EXECUTOR']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const data = await ticketService.getSolicitudData(id, {
        userId: req.user!.userId,
        role: req.user!.role,
      });
      const pdf = await renderSolicitudPdf(data);
      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${data.folio ?? 'solicitud-' + id}.pdf"`);
      res.send(pdf);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// EJECUTOR — crear ticket + subir fotos
// ═══════════════════════════════════════════════════════════════

router.post(
  '/',
  requireRole(RoleGroups.TICKET_CREATORS),
  validateBody(createTicketSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = await ticketService.createTicket(req.user!.userId, req.body as CreateTicketInput);
      res.status(201).json(ticket);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

router.post(
  '/:id/attachments',
  requireRole(RoleGroups.TICKET_CREATORS),
  uploadRateLimit,
  photoUpload.single('photo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo en campo "photo"' });

      const attachment = await ticketService.addAttachment(id, req.user!.userId, {
        url: `/uploads/maintenance-tickets/photos/${req.file.filename}`,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      });
      await enqueueTicketThumbnail(req.file.filename);
      res.status(201).json(serializeTicketAttachment(attachment));
    } catch (err) {
      await removeUploadedFiles(req);
      handleTicketError(err, res, next);
    }
  },
  cleanupUploadedFilesOnError,
);

// ═══════════════════════════════════════════════════════════════
// ADMIN — rechazar / asignar talleres / aprobar
// ═══════════════════════════════════════════════════════════════

router.post(
  '/:id/reject',
  requireRole(RoleGroups.TICKET_ADMINS),
  validateBody(rejectTicketSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const { rejectionReason } = req.body as RejectTicketInput;
      const ticket = await ticketService.rejectTicket(id, req.user!.userId, rejectionReason);
      res.json(ticket);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

router.post(
  '/:id/assign-workshops',
  requireRole(RoleGroups.TICKET_ADMINS),
  validateBody(assignWorkshopsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ticket = await ticketService.assignWorkshops(id, req.user!.userId, req.body as AssignWorkshopsInput);
      res.json({ ...ticket, quotes: ticket.quotes.map(serializeTicketQuote) });
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// Reasignar/cambiar talleres cuando el ticket ya está en AWAITING_QUOTES.
router.post(
  '/:id/reassign-workshops',
  requireRole(RoleGroups.TICKET_ADMINS),
  validateBody(assignWorkshopsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ticket = await ticketService.reassignWorkshops(id, req.user!.userId, req.body as AssignWorkshopsInput);
      res.json({ ...ticket, quotes: ticket.quotes.map(serializeTicketQuote) });
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

router.post(
  '/:id/approve',
  requireRole(RoleGroups.TICKET_ADMINS),
  validateBody(approveTicketSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ticket = await ticketService.approveTicket(id, req.user!.userId, req.body as ApproveTicketInput);
      res.json({
        ...ticket,
        selectedQuote: ticket.selectedQuote
          ? serializeTicketQuote(ticket.selectedQuote)
          : null,
      });
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

router.get(
  '/:id/budget-context',
  requireRole(RoleGroups.TICKET_ADMINS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ctx = await ticketService.getBudgetContext(id);
      res.json(ctx);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// TALLER GANADOR — iniciar / completar reparación
// ═══════════════════════════════════════════════════════════════

router.post(
  '/:id/start-repair',
  requireRole(RoleGroups.WORKSHOP_ONLY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ticket = await ticketService.startRepair(id, req.user!.userId);
      res.json(ticket);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

router.post(
  '/:id/complete-repair',
  requireRole(RoleGroups.WORKSHOP_ONLY),
  validateBody(completeRepairSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req);
      const ticket = await ticketService.completeRepair(id, req.user!.userId, req.body as CompleteRepairInput);
      res.json(ticket);
    } catch (err) {
      handleTicketError(err, res, next);
    }
  },
);

export default router;

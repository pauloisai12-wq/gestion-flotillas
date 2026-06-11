// Endpoints de reportes

import { Router, Request, Response } from 'express';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { generateReportSchema, GenerateReportInput } from '../validators/reportValidator';
import {
  requestReportGeneration,
  getReportHistory,
  getReportById,
} from '../services/reportService';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId, parsePagination, ensureFound } from '../lib/http';

const reportRouter = Router();

// POST /api/reports/generate — Solicitar generación de reporte (solo ADMIN)
reportRouter.post(
  '/generate',
  roleMiddleware(['ADMIN']),
  validateBody(generateReportSchema),
  ah(async (req: Request, res: Response) => {
    const { month, year } = req.body as GenerateReportInput;
    const requestedBy = req.user?.email || 'admin';

    const result = await requestReportGeneration(month, year, requestedBy);
    res.status(202).json({ data: result });
  })
);

// GET /api/reports — Historial de reportes (ADMIN)
reportRouter.get(
  '/',
  roleMiddleware(['ADMIN']),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);

    const result = await getReportHistory(page, limit);
    res.json(result);
  })
);

// GET /api/reports/:id — Detalle de un reporte (ADMIN)
reportRouter.get(
  '/:id',
  roleMiddleware(['ADMIN']),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const report = ensureFound(await getReportById(id), 'Reporte');

    res.json({ data: report });
  })
);

// GET /api/reports/:id/download/:type — Descargar PDF o Excel (ADMIN)
reportRouter.get(
  '/:id/download/:type',
  roleMiddleware(['ADMIN']),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const fileType = req.params.type; // 'pdf' o 'excel'

    const report = ensureFound(await getReportById(id), 'Reporte');

    if (report.status !== 'COMPLETED') {
      res.status(400).json({ error: 'El reporte aún no está listo' });
      return;
    }

    // Determinar ruta del archivo
    let filePath: string | null = null;
    let fileName: string;

    if (fileType === 'pdf') {
      filePath = report.pdfPath;
      fileName = 'reporte_mensual_' + report.year + '_' + String(report.month).padStart(2, '0') + '.pdf';
    } else if (fileType === 'excel') {
      filePath = report.excelPath;
      fileName = 'reporte_mensual_' + report.year + '_' + String(report.month).padStart(2, '0') + '.xlsx';
    } else {
      res.status(400).json({ error: 'Tipo debe ser "pdf" o "excel"' });
      return;
    }

    if (!filePath) {
      res.status(404).json({ error: 'Archivo no disponible' });
      return;
    }

    // Confinar la descarga al directorio del volumen compartido con el worker
    // (defensa contra path traversal si filePath en BD viniera contaminado).
    // Se usa REPORTS_DIR (config) en vez de __dirname, que apunta mal en el
    // build prod (dist/routes) y dejaba la descarga rota.
    const baseDir = path.resolve(env.REPORTS_DIR);
    const safePath = path.resolve(baseDir, path.basename(filePath));

    if (!safePath.startsWith(baseDir + path.sep)) {
      res.status(403).json({ error: 'Ruta no permitida' });
      return;
    }

    if (!fs.existsSync(safePath)) {
      res.status(404).json({ error: 'Archivo no encontrado en disco' });
      return;
    }

    res.download(safePath, fileName);
  })
);

export default reportRouter;
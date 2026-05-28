// Archivo: /flotillas/api/src/routes/reportRouter.ts
// ARCHIVO NUEVO — Endpoints de reportes

import { Router, Request, Response } from 'express';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { generateReportSchema } from '../validators/reportValidator';
import {
  requestReportGeneration,
  getReportHistory,
  getReportById,
} from '../services/reportService';
import path from 'path';
import fs from 'fs';

const reportRouter = Router();

// POST /api/reports/generate — Solicitar generación de reporte (solo ADMIN)
reportRouter.post(
  '/generate',
  roleMiddleware(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const parsed = generateReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Datos inválidos',
          details: parsed.error.issues,
        });
        return;
      }

      const { month, year } = parsed.data;
      const requestedBy = req.user?.email || 'admin';

      const result = await requestReportGeneration(month, year, requestedBy);
      res.status(202).json({ data: result });
    } catch (error: any) {
      res.status(409).json({ error: error.message });
    }
  }
);

// GET /api/reports — Historial de reportes (ADMIN)
reportRouter.get(
  '/',
  roleMiddleware(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await getReportHistory(page, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /api/reports/:id — Detalle de un reporte (ADMIN)
reportRouter.get(
  '/:id',
  roleMiddleware(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const report = await getReportById(id);

      if (!report) {
        res.status(404).json({ error: 'Reporte no encontrado' });
        return;
      }

      res.json({ data: report });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /api/reports/:id/download/:type — Descargar PDF o Excel (ADMIN)
reportRouter.get(
  '/:id/download/:type',
  roleMiddleware(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const fileType = req.params.type; // 'pdf' o 'excel'

      const report = await getReportById(id);

      if (!report) {
        res.status(404).json({ error: 'Reporte no encontrado' });
        return;
      }

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

      // Confinar la descarga al directorio del volumen compartido
      // (defensa contra path traversal si filePath en BD viniera contaminado)
      const baseDir = path.resolve(__dirname, '..', '..', '..', 'storage', 'reports');
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default reportRouter;
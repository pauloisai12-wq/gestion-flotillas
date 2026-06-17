// Router del lado REVISOR_QA. Monta en /api/qa-externa-registros (NUNCA bajo
// /api/qa-externa/*, que pertenece al router de ingesta con guard por API key).
// Todas las rutas exigen el rol REVISOR_QA (JWT + RBAC).
//
//   GET /                       listado paginado + filtros
//   GET /imagenes/:sha256       miniatura/imagen confinada a QA_EXTERNA_DIR
//   GET /export                 ZIP (datos.xlsx + fotos/) de TODA la evidencia

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import * as XLSX from 'xlsx';
import { ah } from '../lib/asyncHandler';
import { requireRole, Roles } from '../middlewares/roleMiddleware';
import { validateQuery } from '../middlewares/validate';
import { parsePagination } from '../lib/http';
import { BadRequest } from '../middlewares/errorHandler';
import {
  qaRegistrosQuerySchema,
  QaRegistrosQueryInput,
} from '../validators/qaExternaRegistrosValidator';
import * as service from '../services/qaExternaRegistrosService';
import prisma from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const router = Router();

/** "2026-06-16T14:30:05.000Z" → "20260616-143005" (UTC). */
function stamp(d: Date): string {
  const iso = d.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  return iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '');
}

// ───────────────────────────────────────────────────────────
// GET / — listado paginado con filtros (tipo, dispositivo, fechas)
// ───────────────────────────────────────────────────────────
router.get(
  '/',
  requireRole([Roles.REVISOR_QA]),
  validateQuery(qaRegistrosQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const q = req.query as unknown as QaRegistrosQueryInput;
    const result = await service.list({
      page,
      limit,
      tipo: q.tipo,
      dispositivo: q.dispositivo,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
    });
    res.json(result);
  }),
);

// ───────────────────────────────────────────────────────────
// GET /imagenes/:sha256 — sirve <sha256>.jpg confinado a QA_EXTERNA_DIR
// ───────────────────────────────────────────────────────────
router.get(
  '/imagenes/:sha256',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const { sha256 } = req.params;
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw BadRequest('Hash inválido');

    // sha256 ya validado como hex de 64 chars; además path.basename + el chequeo
    // startsWith confinan la lectura a QA_EXTERNA_DIR (defensa en profundidad).
    const baseDir = path.resolve(env.QA_EXTERNA_DIR);
    const safePath = path.resolve(baseDir, path.basename(sha256 + '.jpg')); // nosemgrep
    if (!safePath.startsWith(baseDir + path.sep)) throw BadRequest('Ruta inválida');

    if (!fs.existsSync(safePath)) {
      res.status(404).json({ error: 'Imagen no encontrada', code: 'NOT_FOUND' });
      return;
    }

    res.type('image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(safePath).pipe(res);
  }),
);

// ───────────────────────────────────────────────────────────
// GET /export — ZIP con datos.xlsx + fotos/ de TODA la evidencia.
// Orden estricto: una vez que el stream empieza, las cabeceras ya no se pueden
// cambiar, así que todo el trabajo síncrono va ANTES de tocar la respuesta.
// ───────────────────────────────────────────────────────────
router.get(
  '/export',
  requireRole([Roles.REVISOR_QA]),
  ah(async (req: Request, res: Response) => {
    const registros = await service.getAllForExport();

    const baseDir = path.resolve(env.QA_EXTERNA_DIR);

    interface PhotoEntry {
      absPath: string;
      entryName: string;
    }
    const photoEntries: PhotoEntry[] = [];

    interface XlsxRow {
      registro_id: number;
      cliente_registro_id: string;
      identificador_app: string;
      tipo: string;
      lat: number;
      lng: number;
      accuracy: number | string;
      capturado_at: string;
      notas: string;
      dispositivo: string;
      created_at: string;
      archivos: string;
      foto_faltante: string;
    }
    const rows: XlsxRow[] = [];

    for (const r of registros) {
      const archivos: string[] = [];
      let fotoFaltante = false;

      r.imagenes.forEach((ri, n) => {
        const img = ri.imagen;
        const safePath = path.resolve(baseDir, img.sha256 + '.jpg');
        // Confinar al directorio de almacenamiento (el sha256 ya es hex 64, pero
        // se valida la ruta resultante por defensa en profundidad).
        if (!safePath.startsWith(baseDir + path.sep)) {
          fotoFaltante = true;
          return;
        }
        const photoName = `${stamp(r.capturadoAt)}__${r.tipo}__${r.id}${n > 0 ? '_' + n : ''}.jpg`;
        if (fs.existsSync(safePath)) {
          photoEntries.push({ absPath: safePath, entryName: 'fotos/' + photoName });
          archivos.push(photoName);
        } else {
          fotoFaltante = true;
        }
      });

      rows.push({
        registro_id: r.id,
        cliente_registro_id: r.clienteRegistroId,
        identificador_app: r.identificadorApp,
        tipo: r.tipo,
        lat: r.lat,
        lng: r.lng,
        accuracy: r.accuracy ?? '',
        capturado_at: r.capturadoAt.toISOString(),
        notas: r.notas ?? '',
        dispositivo: r.dispositivo.identificador,
        created_at: r.createdAt.toISOString(),
        archivos: archivos.join(', '),
        foto_faltante: fotoFaltante ? 'sí' : '',
      });
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Evidencia');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    // Auditoría best-effort: NO debe bloquear ni romper la descarga.
    try {
      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId ?? null,
          action: 'EXPORT',
          resource: 'QaExternaRegistro',
          metadata: { registros: registros.length, fotos: photoEntries.length },
          ipAddress: (req.ip || '').toString(),
        },
      });
    } catch (err) {
      logger.error({ err }, 'No se pudo auditar EXPORT qa_externa');
    }

    const now = new Date();
    const dateStamp =
      String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="qa-externa-evidencia-' + dateStamp + '.zip"',
    );

    // Nivel 1: los JPEG ya están comprimidos; comprimir de nuevo sería puro coste.
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('warning', (err) => {
      if ((err as { code?: string }).code === 'ENOENT') logger.warn({ err }, 'archiver warning');
      else logger.error({ err }, 'archiver warning fatal');
    });
    archive.on('error', (err) => {
      logger.error({ err }, 'archiver error');
      res.destroy(err);
    });

    archive.pipe(res);
    archive.append(xlsxBuffer, { name: 'datos.xlsx' });
    for (const e of photoEntries) archive.file(e.absPath, { name: e.entryName });
    await archive.finalize();
  }),
);

export default router;

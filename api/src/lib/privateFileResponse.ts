import { constants as fsConstants, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { logger } from './logger';

type PrivateFileOptions = {
  cacheControl: string;
  contentType?: string;
  downloadName?: string;
  varyCookie?: boolean;
  /** Anuncia Accept-Ranges y atiende un Range de UN solo tramo (206/416). Para media que el navegador busca (seek). */
  acceptRanges?: boolean;
};

function isUnavailableFileError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

type Rango = { start: number; end: number } | 'insatisfacible' | null;

/**
 * Un solo tramo `bytes=a-b`, `bytes=a-` o `bytes=-n` (RFC 7233). Cualquier otra
 * sintaxis (multi-rango, otra unidad) se IGNORA y se sirve el archivo completo:
 * es lo que el estándar permite y lo que el <audio> del navegador espera; un
 * tramo fuera del archivo es 416.
 */
function rangoSolicitado(header: string | undefined, size: number): Rango {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (size === 0) return 'insatisfacible';
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'insatisfacible';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return 'insatisfacible';
  return { start, end };
}

/**
 * Abre una sola vez el archivo y transmite desde ese descriptor. Evita la
 * carrera exists/stat -> open, no sigue symlinks en Linux y HEAD solo publica
 * metadatos: nunca materializa ni recorre el contenido.
 *
 * Con `acceptRanges` atiende además peticiones parciales (206) leyendo solo el
 * tramo pedido desde el mismo descriptor; sin el flag el comportamiento es
 * exactamente el anterior (200 completo, ninguna cabecera nueva) para no
 * alterar a los callers que ya existían.
 */
export async function sendPrivateFile(
  req: Request,
  res: Response,
  filePath: string,
  options: PrivateFileOptions,
): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
  } catch (err) {
    if (isUnavailableFileError(err)) return false;
    throw err;
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return false;

    // El 416 se resuelve aquí, antes de fijar Content-Length/Content-Type: la
    // respuesta no lleva cuerpo y su Content-Range describe el tamaño total.
    let status = 200;
    let tramo: { start: number; end: number } | undefined;
    if (options.acceptRanges) {
      res.setHeader('Accept-Ranges', 'bytes');
      const rango = rangoSolicitado(req.headers.range, stat.size);
      if (rango === 'insatisfacible') {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        res.setHeader('Cache-Control', options.cacheControl);
        res.status(416).end();
        return true;
      }
      if (rango) {
        tramo = rango;
        status = 206;
        res.setHeader('Content-Range', `bytes ${rango.start}-${rango.end}/${stat.size}`);
      }
    }

    res.setHeader('Cache-Control', options.cacheControl);
    res.setHeader('Content-Length', tramo ? tramo.end - tramo.start + 1 : stat.size);
    if (options.varyCookie) res.vary('Cookie');
    if (options.downloadName) res.attachment(options.downloadName);
    else if (options.contentType) res.type(options.contentType);

    if (req.method === 'HEAD') {
      res.status(status).end();
      return true;
    }

    const stream = handle.createReadStream({ autoClose: false, ...(tramo ?? {}) });
    res.status(status);
    try {
      await pipeline(stream, res);
    } catch (err) {
      if (!res.headersSent) throw err;
      logger.warn({ err, filePath }, 'Stream privado interrumpido tras enviar headers');
      if (!res.destroyed) res.destroy(err instanceof Error ? err : undefined);
    }
    return true;
  } finally {
    await handle.close().catch((err) => {
      logger.warn({ err, filePath }, 'No se pudo cerrar descriptor de archivo privado');
    });
  }
}

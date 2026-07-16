import { constants as fsConstants, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { logger } from './logger';

type PrivateFileOptions = {
  cacheControl: string;
  contentType?: string;
  downloadName?: string;
  varyCookie?: boolean;
};

function isUnavailableFileError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

/**
 * Abre una sola vez el archivo y transmite desde ese descriptor. Evita la
 * carrera exists/stat -> open, no sigue symlinks en Linux y HEAD solo publica
 * metadatos: nunca materializa ni recorre el contenido.
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

    res.setHeader('Cache-Control', options.cacheControl);
    res.setHeader('Content-Length', stat.size);
    if (options.varyCookie) res.vary('Cookie');
    if (options.downloadName) res.attachment(options.downloadName);
    else if (options.contentType) res.type(options.contentType);

    if (req.method === 'HEAD') {
      res.status(200).end();
      return true;
    }

    const stream = handle.createReadStream({ autoClose: false });
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

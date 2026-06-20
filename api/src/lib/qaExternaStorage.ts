// Almacenamiento content-addressed de imágenes qa_externa. Cada imagen se guarda
// una sola vez como <sha256>.jpg bajo QA_EXTERNA_DIR (subdir del bind mount
// /app/uploads), reforzando la dedupe. Valida JPEG real por magic bytes.

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import imageSize from 'image-size';
import { env } from '../config/env';
import { BadRequest } from '../middlewares/errorHandler';

export interface StoredImage {
  sha256: string;
  ruta: string; // relativa a /app/uploads, p. ej. "qa-externa/<sub>/<sha256>.jpg"
  mime: string; // siempre image/jpeg
  bytes: number;
  width: number | null;
  height: number | null;
}

/** Crea el directorio de almacenamiento si no existe (idempotente). */
export async function ensureQaExternaDir(): Promise<void> {
  await fs.mkdir(env.QA_EXTERNA_DIR, { recursive: true });
}

/**
 * Valida que el buffer sea un JPEG real (magic bytes), calcula su sha256, lee
 * dimensiones (best-effort) y lo escribe en disco SOLO si no existe ya (dedupe).
 * `programa` lo estampa el servidor desde req.device; particiona el almacenamiento
 * en subcarpetas (buffalo/lx) para aislar la evidencia de cada programa.
 */
export async function processImage(
  buffer: Buffer,
  programa: 'BUFFALO' | 'LX',
): Promise<StoredImage> {
  // 1. JPEG real por magic bytes (no confiar en extensión/mime declarado).
  //    file-type 22 es ESM puro → import dinámico (igual que vehicleImportRouter).
  const { fileTypeFromBuffer } = await import('file-type');
  const ft = await fileTypeFromBuffer(buffer);
  if (!ft || ft.ext !== 'jpg' || ft.mime !== 'image/jpeg') {
    throw BadRequest('La imagen no es un JPEG válido');
  }

  // 2. Hash de contenido.
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // 3. Dimensiones (opcionales; si falla el parseo quedan nulas).
  let width: number | null = null;
  let height: number | null = null;
  try {
    const dims = imageSize(buffer);
    width = dims.width ?? null;
    height = dims.height ?? null;
  } catch {
    // dimensiones opcionales
  }

  // 4. Escritura content-addressed. sha256 proviene de createHash (hex de 64
  //    chars); lo validamos y, además, pasamos el nombre por path.basename como
  //    defensa anti path-traversal antes de construir la ruta.
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw BadRequest('Hash de imagen inválido');
  }
  // Nombre derivado de un sha256 validado (hex 64) + path.basename; no es input
  // crudo del usuario, por eso se suprime el falso positivo de path-traversal.
  const filename = path.basename(`${sha256}.jpg`);
  // Subcarpeta por programa (buffalo/lx). `programa` proviene de un enum cerrado
  // estampado por el servidor, no es input crudo.
  const sub = programa === 'BUFFALO' ? 'buffalo' : 'lx';
  const dir = path.join(env.QA_EXTERNA_DIR, sub);
  const absolute = path.join(dir, filename); // nosemgrep
  try {
    await fs.access(absolute);
  } catch {
    // ensureQaExternaDir solo crea el padre; aseguramos también la subcarpeta.
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absolute, buffer);
  }

  return {
    sha256,
    ruta: `qa-externa/${sub}/${filename}`,
    mime: 'image/jpeg',
    bytes: buffer.length,
    width,
    height,
  };
}

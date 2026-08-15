// Almacenamiento content-addressed de imágenes qa_externa. Cada imagen se guarda
// una sola vez como <sha256>.jpg bajo QA_EXTERNA_DIR (subdir del bind mount
// /app/uploads), reforzando la dedupe. Valida JPEG real por magic bytes.

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
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

/**
 * Dimensiones de un JPEG leyendo su segmento SOF, sin dependencias. Sustituye a
 * image-size, retirado por GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq (DoS sin
 * versión parcheada en parsers ICNS/JXL/HEIF que aquí ni se usan: a esta función
 * solo llegan JPEG reales, validados por magic bytes en el paso 1 de processImage).
 * Best-effort como siempre fueron las dimensiones: ante cualquier forma
 * inesperada devuelve null y las columnas quedan nulas.
 * Exportada solo para sus tests (tests/sprint4).
 */
export function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  // El offset crece estrictamente en cada vuelta: aquí no puede haber bucle infinito.
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Relleno 0xFF entre segmentos.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Marcadores sin payload: TEM, RST0-RST7 y SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // EOI antes de encontrar un SOF: no hay dimensiones que leer.
    if (marker === 0xd9) return null;
    // SOF0-SOF15 (0xC0-0xCF) menos DHT (0xC4), JPG (0xC8) y DAC (0xCC): el
    // payload trae [precisión][alto u16][ancho u16].
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    const segLen = buffer.readUInt16BE(offset + 2);
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
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

  // 3. Dimensiones (opcionales; si el parseo no encuentra SOF quedan nulas).
  const dims = jpegDimensions(buffer);
  const width = dims?.width ?? null;
  const height = dims?.height ?? null;

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

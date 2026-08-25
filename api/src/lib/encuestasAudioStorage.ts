// Almacenamiento content-addressed de los audios de encuesta: cada blob vive
// una sola vez como <sha256>.m4a bajo ENCUESTAS_AUDIO_DIR (subdir del bind
// mount /app/uploads). Se guarda TAL CUAL llega —sin transcodificar ni validar
// formato: archivos antiguos pueden ser 3GP/AMR con extensión .m4a— y la
// escritura es atómica (tmp + fsync + rename): el POST solo responde 2xx cuando
// el archivo está persistido, y una lectura concurrente nunca ve un archivo a
// medias. Módulo propio de encuestas: NO importa nada de qa_externa.

import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../config/env';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SUBDIR = 'encuestas-audio';

export function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Crea el directorio (idempotente). Best-effort al arranque; se reintenta al escribir. */
export async function ensureEncuestasAudioDir(): Promise<void> {
  await fs.mkdir(env.ENCUESTAS_AUDIO_DIR, { recursive: true });
}

function nombreArchivo(sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new Error('sha256 inválido para nombre de archivo');
  // Derivado de un hex validado + basename: no es input crudo (nosemgrep).
  return path.basename(`${sha256}.m4a`);
}

/**
 * Ruta absoluta de un blob a partir de la `ruta` guardada en BD. Solo se usa el
 * basename y se comprueba que quede bajo ENCUESTAS_AUDIO_DIR: la BD es de
 * confianza, pero la comprobación cuesta una línea.
 */
export function rutaAbsolutaAudio(ruta: string): string {
  const baseDir = path.resolve(env.ENCUESTAS_AUDIO_DIR);
  const absoluta = path.resolve(baseDir, path.basename(ruta)); // nosemgrep
  if (!absoluta.startsWith(baseDir + path.sep)) throw new Error('Ruta de audio inválida');
  return absoluta;
}

/**
 * Escribe el blob si no existe y devuelve su ruta relativa a /app/uploads
 * (`encuestas-audio/<sha256>.m4a`). Si ya existe (mismo contenido = mismo
 * nombre), no lo toca: es la dedupe física.
 */
export async function guardarAudio(buffer: Buffer, sha256: string): Promise<string> {
  const filename = nombreArchivo(sha256);
  const dir = path.resolve(env.ENCUESTAS_AUDIO_DIR);
  const absoluta = path.join(dir, filename); // nosemgrep
  const ruta = `${SUBDIR}/${filename}`;
  try {
    await fs.access(absoluta);
    return ruta;
  } catch {
    // No existe todavía: se escribe abajo.
  }
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${filename}.${randomUUID()}.tmp`); // nosemgrep
  try {
    const fh = await fs.open(tmp, 'wx');
    try {
      await fh.writeFile(buffer);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, absoluta);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return ruta;
}

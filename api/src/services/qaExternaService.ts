// Núcleo de qa_externa: upsert idempotente del registro por cliente_registro_id,
// dedupe de imágenes por sha256 y vínculo M2M idempotente. Un reintento completo
// (misma clave + mismas imágenes) NO duplica nada y devuelve el mismo registro_id.

import type { QaExternaPrograma } from '@prisma/client';
import prisma from '../lib/prisma';
import { isPrismaKnownError } from '../middlewares/errorHandler';
import { processImage, type StoredImage } from '../lib/qaExternaStorage';

export interface IngestInput {
  clienteRegistroId: string;
  dispositivoId: number;
  identificadorApp: string;
  tipo: 'lona' | 'reunion' | 'barda' | 'otro';
  // Dimensión ortogonal a `tipo`; el servidor la estampa desde req.device
  // (la liga la API key del dispositivo). El cliente NUNCA la envía.
  programa: QaExternaPrograma;
  lat: number;
  lng: number;
  accuracy?: number;
  capturadoAt: Date;
  notas: string | null;
  metadataRaw: string;
  buffers: Buffer[];
}

export interface IngestResult {
  registroId: number;
  imagenes: Array<{
    id: number;
    sha256: string;
    bytes: number;
    mime: string;
    width: number | null;
    height: number | null;
  }>;
}

export async function ingest(input: IngestInput): Promise<IngestResult> {
  return ingestWithDeps(input, { db: prisma, processImage });
}

interface IngestDeps {
  db: typeof prisma;
  processImage: typeof processImage;
}

export async function ingestWithDeps(
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const registroData = {
    dispositivoId: input.dispositivoId,
    identificadorApp: input.identificadorApp,
    tipo: input.tipo,
    programa: input.programa,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy ?? null,
    capturadoAt: input.capturadoAt,
    notas: input.notas,
    metadataRaw: input.metadataRaw,
  };

  // 1. Validar/escribir imágenes antes de tocar la BD. Si el JPEG real falla o
  //    el filesystem no permite escribir, no queda un registro sin imagen.
  const storedImages: StoredImage[] = [];
  for (const buffer of input.buffers) {
    storedImages.push(await deps.processImage(buffer, input.programa));
  }

  const writeOnce = () =>
    deps.db.$transaction(async (tx) => {
      // 2. Upsert idempotente del registro (last-write-wins). Ante dos POST
      //    concurrentes con la misma clave, un P2002 aborta esta transacción;
      //    el retry controlado ocurre afuera con una transacción nueva.
      const registro = await tx.qaExternaRegistro.upsert({
        where: { clienteRegistroId: input.clienteRegistroId },
        create: { clienteRegistroId: input.clienteRegistroId, ...registroData },
        update: registroData,
      });

      // 3. Por imagen: upsert por sha256 (dedupe en BD) y vínculo idempotente.
      const imagenes: IngestResult['imagenes'] = [];
      for (const meta of storedImages) {
        const imagen = await tx.qaExternaImagen.upsert({
          where: { sha256_programa: { sha256: meta.sha256, programa: input.programa } },
          create: {
            sha256: meta.sha256,
            programa: input.programa,
            ruta: meta.ruta,
            mime: meta.mime,
            bytes: meta.bytes,
            width: meta.width,
            height: meta.height,
          },
          update: {}, // dedupe: no se reescriben bytes ni metadatos
        });

        // Vínculo idempotente (PK compuesta → skipDuplicates evita duplicar).
        await tx.qaExternaRegistroImagen.createMany({
          data: [{ registroId: registro.id, imagenId: imagen.id }],
          skipDuplicates: true,
        });

        imagenes.push({
          id: imagen.id,
          sha256: imagen.sha256,
          bytes: imagen.bytes,
          mime: imagen.mime,
          width: imagen.width,
          height: imagen.height,
        });
      }

      return { registroId: registro.id, imagenes };
    });

  try {
    return await writeOnce();
  } catch (e) {
    if (isPrismaKnownError(e, 'P2002')) {
      return writeOnce();
    }
    throw e;
  }
}

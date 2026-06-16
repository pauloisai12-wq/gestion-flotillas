// Núcleo de qa_externa: upsert idempotente del registro por cliente_registro_id,
// dedupe de imágenes por sha256 y vínculo M2M idempotente. Un reintento completo
// (misma clave + mismas imágenes) NO duplica nada y devuelve el mismo registro_id.

import prisma from '../lib/prisma';
import { isPrismaKnownError } from '../middlewares/errorHandler';
import { processImage } from '../lib/qaExternaStorage';

export interface IngestInput {
  clienteRegistroId: string;
  dispositivoId: number;
  identificadorApp: string;
  tipo: 'lona' | 'reunion' | 'barda' | 'otro';
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
  const registroData = {
    dispositivoId: input.dispositivoId,
    identificadorApp: input.identificadorApp,
    tipo: input.tipo,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy ?? null,
    capturadoAt: input.capturadoAt,
    notas: input.notas,
    metadataRaw: input.metadataRaw,
  };

  // 1. Upsert idempotente del registro (last-write-wins). Ante dos POST
  //    concurrentes con la misma clave, uno crea y el otro choca con el UNIQUE
  //    (P2002) → caemos a update y ambos convergen al mismo id.
  let registro;
  try {
    registro = await prisma.qaExternaRegistro.upsert({
      where: { clienteRegistroId: input.clienteRegistroId },
      create: { clienteRegistroId: input.clienteRegistroId, ...registroData },
      update: registroData,
    });
  } catch (e) {
    if (isPrismaKnownError(e, 'P2002')) {
      registro = await prisma.qaExternaRegistro.update({
        where: { clienteRegistroId: input.clienteRegistroId },
        data: registroData,
      });
    } else {
      throw e;
    }
  }

  // 2. Por imagen: validar/escribir (dedupe en disco), upsert por sha256 (dedupe
  //    en BD) y vincular al registro sin duplicar el vínculo.
  const imagenes: IngestResult['imagenes'] = [];
  for (const buffer of input.buffers) {
    const meta = await processImage(buffer);

    let imagen;
    try {
      imagen = await prisma.qaExternaImagen.upsert({
        where: { sha256: meta.sha256 },
        create: {
          sha256: meta.sha256,
          ruta: meta.ruta,
          mime: meta.mime,
          bytes: meta.bytes,
          width: meta.width,
          height: meta.height,
        },
        update: {}, // dedupe: no se reescriben bytes ni metadatos
      });
    } catch (e) {
      if (isPrismaKnownError(e, 'P2002')) {
        imagen = await prisma.qaExternaImagen.findUniqueOrThrow({
          where: { sha256: meta.sha256 },
        });
      } else {
        throw e;
      }
    }

    // Vínculo idempotente (PK compuesta → skipDuplicates evita duplicar).
    await prisma.qaExternaRegistroImagen.createMany({
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
}

// Núcleo de la segunda captura de qa_externa ("registro de personas"): upsert
// idempotente por cliente_registro_id. Aquí NO hay imágenes ni tabla puente, así
// que basta una sola escritura y no hace falta transacción: reenviar la misma
// clave actualiza la fila y devuelve el MISMO registro_id, nunca crea otra.

import type { QaExternaPrograma } from '@prisma/client';
import prisma from '../lib/prisma';
import { isPrismaKnownError } from '../middlewares/errorHandler';

export interface IngestPersonaInput {
  clienteRegistroId: string;
  dispositivoId: number;
  identificadorApp: string;
  // Igual que en el ingest de evidencia: el servidor la estampa desde
  // req.device (la liga la API key). El cliente NUNCA la envía.
  programa: QaExternaPrograma;
  nombre: string;
  telefono: string;
  lat: number;
  lng: number;
  accuracy?: number;
  capturadoAt: Date;
  metadataRaw: string | null;
}

export interface IngestPersonaResult {
  registroId: number;
}

export async function ingestPersona(
  input: IngestPersonaInput,
): Promise<IngestPersonaResult> {
  return ingestPersonaWithDeps(input, { db: prisma });
}

interface IngestPersonaDeps {
  db: typeof prisma;
}

export async function ingestPersonaWithDeps(
  input: IngestPersonaInput,
  deps: IngestPersonaDeps,
): Promise<IngestPersonaResult> {
  const personaData = {
    dispositivoId: input.dispositivoId,
    identificadorApp: input.identificadorApp,
    programa: input.programa,
    nombre: input.nombre,
    telefono: input.telefono,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy ?? null,
    capturadoAt: input.capturadoAt,
    metadataRaw: input.metadataRaw,
  };

  // Upsert last-write-wins: el update NUNCA toca clienteRegistroId, que es la
  // identidad de la captura del lado del cliente.
  const writeOnce = () =>
    deps.db.qaExternaPersona.upsert({
      where: { clienteRegistroId: input.clienteRegistroId },
      create: { clienteRegistroId: input.clienteRegistroId, ...personaData },
      update: personaData,
    });

  try {
    const persona = await writeOnce();
    return { registroId: persona.id };
  } catch (e) {
    // Dos POST concurrentes con la misma clave (la app reintenta al recuperar
    // señal): el upsert que pierde la carrera ve la fila aparecer entre su
    // SELECT y su INSERT y Prisma devuelve P2002. Un único reintento ya la
    // encuentra y cae por la rama update.
    if (isPrismaKnownError(e, 'P2002')) {
      const persona = await writeOnce();
      return { registroId: persona.id };
    }
    throw e;
  }
}

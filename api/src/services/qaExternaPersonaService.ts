// Núcleo de la segunda captura de qa_externa ("registro de personas"): escritura
// idempotente por (cliente_registro_id, programa). Aquí NO hay imágenes ni tabla
// puente ni ruta de borrado, así que no hace falta transacción: reenviar la misma
// clave desde el mismo programa actualiza la fila y devuelve el MISMO registro_id,
// nunca crea otra; la misma clave desde el otro programa es un 409.

import type { QaExternaPrograma } from '@prisma/client';
import prisma from '../lib/prisma';
import { Conflict, isPrismaKnownError } from '../middlewares/errorHandler';

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

  // Update SOLO dentro del mismo programa: last-write-wins entre reintentos/
  // reinstalaciones del mismo dispositivo, pero nunca "roba" una fila que ya
  // pertenece a otro programa (partición de seguridad Buffalo/LX estampada
  // por la API key). El update NUNCA toca clienteRegistroId, que es la
  // identidad de la captura del lado del cliente.
  const tryUpdate = () =>
    deps.db.qaExternaPersona.updateMany({
      where: { clienteRegistroId: input.clienteRegistroId, programa: input.programa },
      data: personaData,
    });

  const updated = await tryUpdate();
  if (updated.count === 1) {
    const persona = await deps.db.qaExternaPersona.findUnique({
      where: { clienteRegistroId: input.clienteRegistroId },
    });
    return { registroId: persona!.id };
  }

  try {
    const persona = await deps.db.qaExternaPersona.create({
      data: { clienteRegistroId: input.clienteRegistroId, ...personaData },
    });
    return { registroId: persona.id };
  } catch (e) {
    // Dos POST concurrentes con la misma clave (la app reintenta al recuperar
    // señal): el create que pierde la carrera ve la fila aparecer entre su
    // SELECT y su INSERT y Prisma devuelve P2002. Reintentamos el update
    // acotado por programa: si ahora encuentra la fila (mismo programa) cae
    // en update; si la fila pertenece a otro programa, es un 409 real.
    if (isPrismaKnownError(e, 'P2002')) {
      const retried = await tryUpdate();
      if (retried.count === 1) {
        const persona = await deps.db.qaExternaPersona.findUnique({
          where: { clienteRegistroId: input.clienteRegistroId },
        });
        return { registroId: persona!.id };
      }
      throw Conflict('cliente_registro_id ya registrado en otro programa');
    }
    throw e;
  }
}

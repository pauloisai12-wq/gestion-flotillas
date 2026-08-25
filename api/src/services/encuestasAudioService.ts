// Persistencia de un segmento de audio ya validado (hash y tamaño comprobados
// por el router). Orden: blob a disco PRIMERO (content-addressed, atómico) y
// fila DESPUÉS: nunca existe una fila sin archivo; a lo sumo un blob huérfano si
// la BD falla, que el siguiente reintento reutiliza.
//
//   findUnique(encuestaId, segmento)
//     sin fila            → create → {created:true}
//     misma sha256        → {created:false}, mismo id (reenvío idempotente)
//     sha256 distinta     → update (gana el último) → {created:false}, mismo id
//   P2002 en el create    → un reintento entero (la carrera la ganó otro POST)
//
// Sin `$transaction`, igual que encuestasIngestService.ts: es UNA sola escritura
// y el UNIQUE (encuesta_id, segmento) es quien arbitra la carrera; envolverla en
// una transacción no añadiría atomicidad, solo una conexión retenida más.

import prisma from '../lib/prisma';
import { isPrismaKnownError } from '../middlewares/errorHandler';
import { guardarAudio } from '../lib/encuestasAudioStorage';
import { duracionMsIsoBmff } from '../lib/audioDuration';

export interface GuardarAudioInput {
  encuestaId: number;
  segmento: string;
  sha256: string;
  tamanoBytes: number;
  mimeDeclarado: string | null;
  buffer: Buffer;
}

export interface GuardarAudioResult {
  audioId: number;
  created: boolean;
}

export interface GuardarAudioDeps {
  // Superficie mínima: solo el delegado `encuestaAudio` y solo los tres métodos
  // del flujo. Se deriva del tipo del cliente REAL (no de `PrismaClient`) porque
  // el singleton de lib/prisma va extendido y su tipo no es asignable a
  // `Pick<PrismaClient, …>`; mismo patrón que encuestasIngestService.ts.
  db: { encuestaAudio: Pick<typeof prisma.encuestaAudio, 'findUnique' | 'create' | 'update'> };
  guardarEnDisco: (buffer: Buffer, sha256: string) => Promise<string>;
}

export function guardarAudioEncuesta(input: GuardarAudioInput): Promise<GuardarAudioResult> {
  return guardarAudioEncuestaWithDeps(input, { db: prisma, guardarEnDisco: guardarAudio });
}

export async function guardarAudioEncuestaWithDeps(
  input: GuardarAudioInput,
  deps: GuardarAudioDeps,
): Promise<GuardarAudioResult> {
  const ruta = await deps.guardarEnDisco(input.buffer, input.sha256);
  const duracionMs = duracionMsIsoBmff(input.buffer);
  const { encuestaId, segmento, sha256, tamanoBytes, mimeDeclarado } = input;

  const escribir = async (): Promise<GuardarAudioResult> => {
    const existente = await deps.db.encuestaAudio.findUnique({
      where: { encuestaId_segmento: { encuestaId, segmento } },
      select: { id: true, sha256: true },
    });
    if (existente) {
      if (existente.sha256 === sha256) return { audioId: existente.id, created: false };
      // Por contrato los segmentos son inmutables; si aun así llega otro
      // contenido, se reemplaza y el audio_id no cambia (lo pide el contrato).
      await deps.db.encuestaAudio.update({
        where: { id: existente.id },
        data: { sha256, tamanoBytes, mimeDeclarado, ruta, duracionMs, recibidoEn: new Date() },
        select: { id: true },
      });
      return { audioId: existente.id, created: false };
    }
    const fila = await deps.db.encuestaAudio.create({
      data: { encuestaId, segmento, sha256, tamanoBytes, mimeDeclarado, ruta, duracionMs },
      select: { id: true },
    });
    return { audioId: fila.id, created: true };
  };

  try {
    return await escribir();
  } catch (e) {
    if (!isPrismaKnownError(e, 'P2002')) throw e;
    return escribir();
  }
}

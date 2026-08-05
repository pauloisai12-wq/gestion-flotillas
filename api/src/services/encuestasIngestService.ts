// Alta de una encuesta v3 ya validada. El contrato con la app móvil es
// idempotente por `idLocal` (el UUID que genera el teléfono): el mismo id
// reenviado devuelve SIEMPRE el mismo `idRemoto`, y el mismo id con contenido
// sustantivo distinto es un 409 que no sobrescribe nada.
//
// Flujo (sin transacción, a propósito):
//   create → 201 {idRemoto, created:true}
//   P2002  → findUnique(idLocal)
//              sin fila       → se relanza el P2002 (carrera exótica: el choque
//                               vino de otro UNIQUE —idRemoto— o la fila se
//                               borró en medio; el teléfono reintenta)
//              mismo hash     → 200 {idRemoto original, created:false}
//              hash distinto  → 409, sin tocar la fila existente
//   cualquier otro error → propaga (500)
//
// Por qué NO hay `$transaction`: la escritura es UN SOLO INSERT. Las listas de
// texto libre y la aprobación por gobernante viven en columnas JSONB en vez de
// una tabla hija justamente para eso (schema.prisma, modelo Encuesta), así que
// el escenario "un error de BD deja escrituras parciales" no existe por
// construcción, no por disciplina de código: o entra la fila entera o no entra
// nada. El `findUnique` del catch es una LECTURA, y leer fuera de transacción
// tras un UNIQUE violado es exactamente lo que se quiere: ve la fila que ganó
// la carrera, que es la que hay que devolver.
//
// La comparación de contenido va por `payloadHash` (lib/encuestasCanonical.ts),
// no campo a campo: el hash ya ignora lo que no es sustantivo (los campos de la
// cola de envío del teléfono, el orden de los arrays, el formato de las fechas).

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { Conflict, isPrismaKnownError } from '../middlewares/errorHandler';
import {
  GOBERNANTES_V3,
  type EncuestaV3,
} from '../validators/encuestasIngestValidator';

export interface IngestEncuestaInput {
  /** Salida de `encuestaV3Schema`: lo ÚNICO que se aplana a columnas. */
  parsed: EncuestaV3;
  /** Estampado server-side desde la API key autenticada; el cliente no lo envía. */
  dispositivoId: number;
  payloadHash: string;
  /** Body crudo tal como llegó (auditoría). Nunca sale en DTO ni en CSV. */
  payloadRaw: string | null;
}

export interface IngestEncuestaResult {
  idRemoto: string;
  /** true → 201 (fila nueva); false → 200 (reenvío del mismo contenido). */
  created: boolean;
}

interface IngestEncuestaDeps {
  // Superficie mínima: solo el delegado `encuesta` y solo los dos métodos del
  // flujo. Se deriva del tipo real del cliente para que `prisma` encaje sin
  // castear y para que un cambio de firma de Prisma se vea aquí, no en runtime.
  db: { encuesta: Pick<typeof prisma.encuesta, 'create' | 'findUnique'> };
}

type RespuestasRow = Pick<
  Prisma.EncuestaUncheckedCreateInput,
  | 'sexo'
  | 'rangoEdad'
  | 'empresariosConocidos'
  | 'politicosConocidos'
  | 'conoceLalo'
  | 'rolLalo'
  | 'opinionLalo'
  | 'preferenciaElectoral'
  | 'preferenciaPartido'
  | 'aprobacionPorGobernante'
>;

type UbicacionRow = Pick<
  Prisma.EncuestaUncheckedCreateInput,
  | 'ubicacionDisponible'
  | 'ubicacionLat'
  | 'ubicacionLng'
  | 'ubicacionPrecisionM'
  | 'ubicacionCapturadaAt'
  | 'ubicacionEsValida'
  | 'ubicacionPermiso'
  | 'ubicacionServicioActivo'
  | 'ubicacionMotivoNoDisponible'
>;

function respuestasRow(d: EncuestaV3): RespuestasRow {
  const r = d.respuestas;
  // Se guarda la MISMA normalización que entra al hash (encuestasCanonical.ts):
  // la aprobación reordenada al catálogo de GOBERNANTES_V3; las listas de texto
  // libre tal como llegaron (su orden es dato). El validador garantiza los 3
  // gobernantes sin repetir, así que el .get() nunca queda en undefined.
  const califPorGobernante = new Map(
    r.aprobacionPorGobernante.map((fila) => [fila.gobernante, fila.calificacion] as const),
  );
  return {
    sexo: r.sexo,
    rangoEdad: r.rangoEdad,
    empresariosConocidos: r.empresariosConocidos,
    politicosConocidos: r.politicosConocidos,
    conoceLalo: r.conoceLalo,
    rolLalo: r.rolLalo,
    opinionLalo: r.opinionLalo,
    preferenciaElectoral: r.preferenciaElectoral,
    preferenciaPartido: r.preferenciaPartido,
    aprobacionPorGobernante: GOBERNANTES_V3.map((gobernante) => ({
      gobernante,
      calificacion: califPorGobernante.get(gobernante)!,
    })),
  };
}

function ubicacionRow(u: EncuestaV3['ubicacion']): UbicacionRow {
  if (!u) {
    // Bloque AUSENTE (app vieja sin GPS): `ubicacionDisponible` queda en NULL,
    // que es distinto de `false` ("el teléfono no la pudo capturar"). El
    // revisor necesita poder separar los dos casos.
    return {
      ubicacionDisponible: null,
      ubicacionLat: null,
      ubicacionLng: null,
      ubicacionPrecisionM: null,
      ubicacionCapturadaAt: null,
      ubicacionEsValida: null,
      ubicacionPermiso: null,
      ubicacionServicioActivo: null,
      ubicacionMotivoNoDisponible: null,
    };
  }

  if (u.disponible) {
    return {
      ubicacionDisponible: true,
      ubicacionLat: u.latitud,
      ubicacionLng: u.longitud,
      ubicacionPrecisionM: u.precisionMetros,
      ubicacionCapturadaAt: u.fechaHoraCaptura,
      ubicacionEsValida: u.esValida,
      ubicacionPermiso: u.permiso,
      ubicacionServicioActivo: u.servicioActivo,
      ubicacionMotivoNoDisponible: null,
    };
  }

  return {
    ubicacionDisponible: false,
    ubicacionLat: null,
    ubicacionLng: null,
    ubicacionPrecisionM: null,
    ubicacionCapturadaAt: null,
    ubicacionEsValida: null,
    ubicacionPermiso: u.permiso,
    ubicacionServicioActivo: u.servicioActivo,
    ubicacionMotivoNoDisponible: u.motivoNoDisponible,
  };
}

/** Aplana la encuesta validada a las columnas del modelo `Encuesta`. */
function mapEncuestaToRow(input: IngestEncuestaInput): Prisma.EncuestaUncheckedCreateInput {
  const d = input.parsed;
  return {
    idLocal: d.idLocal,
    dispositivoId: input.dispositivoId,
    payloadHash: input.payloadHash,
    versionCuestionario: d.versionCuestionario,
    // Ausente ≡ NULL: el folio del talonario es opcional y NO es único.
    folioLocal: d.folioLocal ?? null,
    // Ausente ≡ NULL: lo mandan las versiones de la app que ya lo capturan.
    encuestador: d.encuestador ?? null,
    estado: d.estado,
    fechaHoraInicio: d.fechaHoraInicio,
    fechaHoraFinalizacion: d.fechaHoraFinalizacion,
    duracionSegundos: d.duracionSegundos,
    ...respuestasRow(d),
    ...ubicacionRow(d.ubicacion),
    dispositivoPlataforma: d.dispositivo.plataforma,
    dispositivoModelo: d.dispositivo.modelo,
    dispositivoVersionSistema: d.dispositivo.versionSistema,
    versionAplicacion: d.versionAplicacion,
    payloadRaw: input.payloadRaw,
    // idRemoto NO se pasa: lo genera el @default(uuid()) del modelo. Es el
    // identificador que ve la app, y solo el servidor lo emite.
  };
}

export async function ingestEncuesta(
  input: IngestEncuestaInput,
): Promise<IngestEncuestaResult> {
  return ingestEncuestaWithDeps(input, { db: prisma });
}

export async function ingestEncuestaWithDeps(
  input: IngestEncuestaInput,
  deps: IngestEncuestaDeps,
): Promise<IngestEncuestaResult> {
  const data = mapEncuestaToRow(input);

  try {
    const fila = await deps.db.encuesta.create({ data });
    return { idRemoto: fila.idRemoto, created: true };
  } catch (e) {
    // Solo el choque de UNIQUE entra al camino idempotente. Cualquier otro
    // error (FK del dispositivo, BD caída, valor demasiado largo) propaga tal
    // cual: no hay nada escrito que reconciliar.
    if (!isPrismaKnownError(e, 'P2002')) throw e;

    const existente = await deps.db.encuesta.findUnique({
      where: { idLocal: input.parsed.idLocal },
    });
    // El UNIQUE saltó pero no hay fila con este idLocal: o el choque fue de otro
    // índice (idRemoto, colisión de UUID ≈ imposible) o la fila desapareció
    // entre el INSERT y esta lectura. No se inventa un resultado: se relanza y
    // el teléfono, que reintenta por diseño, vuelve a intentarlo.
    if (!existente) throw e;

    if (existente.payloadHash === input.payloadHash) {
      // Reenvío del MISMO contenido (la app reintenta al recuperar señal, o su
      // ACK se perdió): 200 con el idRemoto original, una sola fila.
      return { idRemoto: existente.idRemoto, created: false };
    }

    // Mismo idLocal, contenido sustantivo distinto: la encuesta cerrada es
    // inmutable, así que NO hay last-write-wins (a diferencia del registro de
    // personas de qa_externa). Se rechaza y la fila original queda intacta.
    throw Conflict('idLocal ya registrado con contenido distinto');
  }
}

// Canonicalización y hash del contenido de una encuesta v3. El hash es la mitad
// sustantiva de la idempotencia: el UNIQUE de idLocal decide si la fila ya
// existe, y este hash decide si el reenvío trae el MISMO contenido (200 con el
// idRemoto original) o uno distinto (409, sin sobrescribir).
//
// Qué entra al hash: todo lo que el validador dejó pasar — identidad (idLocal,
// folioLocal, encuestador), versión del cuestionario, estado, fechas, duración,
// respuestas, ubicación, y también `dispositivo{...}` y `versionAplicacion` (el
// contrato solo excluye lo de abajo; si el equipo móvil confirmara que esos
// metadatos se estampan al ENVIAR y no al capturar, habría que sacarlos, porque
// un reintento tras actualizar la app daría 409).
//
// Qué NO entra: el idRemoto que el servidor devolvió y los cuatro campos de la
// cola de envío del teléfono (estadoSincronizacion, numeroIntentosSincronizacion,
// fechaUltimoIntento, fechaSincronizacion). Ni siquiera llegan hasta aquí: el
// schema no los declara y zod los estripa. Describen el transporte, no la
// encuesta, y cambian entre el primer envío y el reintento.
//
// Normalizaciones, todas para que dos envíos del MISMO contenido no den hashes
// distintos por detalles de serialización del teléfono:
//  - orden de claves fijo POR CONSTRUCCIÓN (el objeto se reconstruye literal;
//    JSON.stringify respeta el orden de inserción), así que no hace falta
//    ordenar claves ni depender de cómo llegó el body;
//  - fechas por toISOString(): 'Z', '+00:00' y los milisegundos explícitos son
//    el mismo instante escrito de tres formas;
//  - aprobacionPorGobernante reordenado al orden de GOBERNANTES_V3: es un
//    conjunto de respuestas, el orden en que la app los serializa no es dato;
//  - politicosConocidos y empresariosConocidos NO se reordenan: son listas de
//    texto libre donde el orden en que el encuestador las dictó es parte del dato;
//  - folioLocal, encuestador y ubicacion ausentes ≡ null.
//
// `v` es la versión del ALGORITMO de canonicalización, no la del cuestionario:
// si algún día cambia una de estas reglas, subirla evita comparar hashes viejos
// contra nuevos como si fueran del mismo esquema.

import { createHash } from 'crypto';
import {
  GOBERNANTES_V3,
  type EncuestaV3,
} from '../validators/encuestasIngestValidator';

const VERSION_CANONICA = 2;

function respuestasCanonicas(d: EncuestaV3) {
  const r = d.respuestas;
  // El validador garantiza los 3 gobernantes sin repetir: el índice es total y
  // el .get() nunca queda en undefined. Se reordena al catálogo porque es un
  // conjunto de respuestas; las listas de texto libre NO se reordenan (el orden
  // en que el encuestador las dictó es parte del dato y el teléfono reenvía el
  // mismo JSON).
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

function ubicacionCanonica(u: EncuestaV3['ubicacion']) {
  if (!u) return null;
  if (u.disponible) {
    return {
      disponible: u.disponible,
      latitud: u.latitud,
      longitud: u.longitud,
      precisionMetros: u.precisionMetros,
      fechaHoraCaptura: u.fechaHoraCaptura.toISOString(),
      permiso: u.permiso,
      servicioActivo: u.servicioActivo,
      esValida: u.esValida,
    };
  }
  return {
    disponible: u.disponible,
    permiso: u.permiso,
    servicioActivo: u.servicioActivo,
    motivoNoDisponible: u.motivoNoDisponible,
  };
}

/**
 * Representación estable del contenido sustantivo de una encuesta ya validada.
 * Orden de claves fijo por construcción, campos ausentes normalizados a null,
 * gobernantes reordenados al catálogo. El orden de las claves se reconstruye
 * literal, así que reordenar el objeto literal invalida todos los payloadHash
 * guardados.
 */
export function canonicalizarEncuestaV3(d: EncuestaV3): string {
  return JSON.stringify({
    v: VERSION_CANONICA,
    idLocal: d.idLocal,
    folioLocal: d.folioLocal ?? null,
    encuestador: d.encuestador ?? null,
    versionCuestionario: d.versionCuestionario,
    estado: d.estado,
    fechaHoraInicio: d.fechaHoraInicio.toISOString(),
    fechaHoraFinalizacion: d.fechaHoraFinalizacion.toISOString(),
    duracionSegundos: d.duracionSegundos,
    respuestas: respuestasCanonicas(d),
    ubicacion: ubicacionCanonica(d.ubicacion),
    dispositivo: {
      plataforma: d.dispositivo.plataforma,
      modelo: d.dispositivo.modelo,
      versionSistema: d.dispositivo.versionSistema,
    },
    versionAplicacion: d.versionAplicacion,
  });
}

/**
 * sha256 hex de la forma canónica. Es lo que se guarda en `payloadHash` para
 * detectar reenvíos con contenido idéntico (200) vs. contenido distinto (409).
 */
export function hashEncuestaV3(d: EncuestaV3): string {
  return createHash('sha256').update(canonicalizarEncuestaV3(d), 'utf8').digest('hex');
}

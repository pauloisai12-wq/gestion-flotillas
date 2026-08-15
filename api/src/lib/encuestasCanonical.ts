// Canonicalización y hash del contenido de una encuesta ya validada, v1, v3 y v4. El
// hash es la mitad sustantiva de la idempotencia: el UNIQUE de idLocal decide si
// la fila ya existe, y este hash decide si el reenvío trae el MISMO contenido
// (200 con el idRemoto original) o uno distinto (409, sin sobrescribir).
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
//
// Aquí conviven los TRES cuestionarios que el servidor sabe recibir: el v3
// vigente, el v4 expandido, y el v1 restaurado. Cada uno reconstruye su propio
// objeto literal — las reglas de arriba valen para los tres, pero el bloque de
// respuestas y el orden de claves son de cada versión (v4 expande respuestas
// con campos opcionales de texto). Lo único compartido es `ubicacionCanonica`,
// que es idéntica entre versiones. Salvo eso, tocar uno no puede mover el hash
// del otro.

import { createHash } from 'crypto';
import {
  GOBERNANTES_V3,
  MEDIOS_V1,
  PERSONAS_V1,
  type EncuestaV1,
  type EncuestaV3,
  type EncuestaV4,
} from '../validators/encuestasIngestValidator';

// La versión canónica es POR CUESTIONARIO, no del archivo: el v1 se quedó en 1
// porque los payloadHash de los registros v1 guardados antes del reemplazo
// tienen que seguir coincidiendo. El v3 está en 2 y el v4 en 3: aunque ambos
// tienen el mismo bloque de respuestas v3 (enums idénticos), el v4 expande ese
// bloque con dos campos opcionales de texto (preferenciaElectoralOtro,
// preferenciaPartidoOtro) que van al canónico, cambiando la forma. Subir la
// versión distingue los hashes v3 de los v4 incluso si versionCuestionario
// fuera a su vez una desambiguación (aquí versionCuestionario entra en el
// canónico, así que técnicamente no hace falta; el número existe para que el
// cambio de forma esté documentado y evitar futuras confusiones).
const VERSION_CANONICA = 2;
const VERSION_CANONICA_V1 = 1;
const VERSION_CANONICA_V4 = 3;

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

function respuestasCanonicasV4(d: EncuestaV4) {
  const r = d.respuestas;
  // Análoga a respuestasCanonicas, pero con campos opcionales de texto para
  // "otro". Ausente ≡ null tras trim para normalizar reenvíos. El orden de
  // claves es fijo: los campos de "otro" van inmediatamente después de sus
  // correspondientes enums de preferencia.
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
    preferenciaElectoralOtro: r.preferenciaElectoralOtro ?? null,
    preferenciaPartido: r.preferenciaPartido,
    preferenciaPartidoOtro: r.preferenciaPartidoOtro ?? null,
    aprobacionPorGobernante: GOBERNANTES_V3.map((gobernante) => ({
      gobernante,
      calificacion: califPorGobernante.get(gobernante)!,
    })),
  };
}

// Compartida por las tres versiones: la forma de `ubicacion` es la misma en v1,
// v3 y v4 (el schema la declara una sola vez), así que el union de tipos es
// una formalidad para TS, no tres formas distintas.
function ubicacionCanonica(u: EncuestaV1['ubicacion'] | EncuestaV3['ubicacion']) {
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

/**
 * Representación estable del contenido sustantivo de una encuesta v4 ya validada.
 * Igual a v3, pero con los campos opcionales de texto para "otro".
 */
export function canonicalizarEncuestaV4(d: EncuestaV4): string {
  return JSON.stringify({
    v: VERSION_CANONICA_V4,
    idLocal: d.idLocal,
    folioLocal: d.folioLocal ?? null,
    encuestador: d.encuestador ?? null,
    versionCuestionario: d.versionCuestionario,
    estado: d.estado,
    fechaHoraInicio: d.fechaHoraInicio.toISOString(),
    fechaHoraFinalizacion: d.fechaHoraFinalizacion.toISOString(),
    duracionSegundos: d.duracionSegundos,
    respuestas: respuestasCanonicasV4(d),
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
 * sha256 hex de la forma canónica v4.
 */
export function hashEncuestaV4(d: EncuestaV4): string {
  return createHash('sha256').update(canonicalizarEncuestaV4(d), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Cuestionario v1 (restaurado)
// ---------------------------------------------------------------------------
// Textual al histórico, porque cualquier variación cambiaría el payloadHash de
// los registros v1 ya guardados y convertiría cada reenvío en un 409. Sus dos
// diferencias con el v3: `elegibilidad` entra al canónico (el v1 la trae como
// campo propio) y los conjuntos que se reordenan son conocimientoPorPersona (al
// orden de PERSONAS_V1) y los medios (al de MEDIOS_V1).

function respuestasCanonicasV1(d: EncuestaV1) {
  if (d.estado === 'noElegible') {
    // P2–P8 no existen en esta rama: el bloque es fijo y siempre el mismo.
    return {
      credencialVigente: d.respuestas.credencialVigente,
      conocimientoPorPersona: [] as const,
    };
  }
  const r = d.respuestas;
  // El validador garantiza las 7 personas del catálogo sin repetir, así que este
  // índice es total y el .get() de abajo nunca queda en undefined.
  const nivelPorPersona = new Map(
    r.conocimientoPorPersona.map((fila) => [fila.persona, fila.nivel] as const),
  );
  const medios = r.mediosConocimiento;
  return {
    credencialVigente: r.credencialVigente,
    rangoEdad: r.rangoEdad,
    genero: r.genero,
    partidoPreferido: r.partidoPreferido,
    conocimientoPorPersona: PERSONAS_V1.map((persona) => ({
      persona,
      nivel: nivelPorPersona.get(persona)!,
    })),
    mediosConocimiento:
      medios.tipo === 'respondida'
        ? { tipo: medios.tipo, medios: MEDIOS_V1.filter((m) => medios.medios.includes(m)) }
        : { tipo: medios.tipo },
    mayorPersonalidad: r.mayorPersonalidad,
    candidatoPreferido: r.candidatoPreferido,
  };
}

/** Representación estable del contenido sustantivo de una encuesta ya validada. */
export function canonicalizarEncuestaV1(d: EncuestaV1): string {
  return JSON.stringify({
    v: VERSION_CANONICA_V1,
    idLocal: d.idLocal,
    folioLocal: d.folioLocal ?? null,
    // Se sumó SIN subir `v`: el campo entró antes de cualquier despliegue, así
    // que no existe ni un payloadHash guardado con el que pudiera chocar.
    encuestador: d.encuestador ?? null,
    versionCuestionario: d.versionCuestionario,
    estado: d.estado,
    elegibilidad: d.elegibilidad,
    fechaHoraInicio: d.fechaHoraInicio.toISOString(),
    fechaHoraFinalizacion: d.fechaHoraFinalizacion.toISOString(),
    duracionSegundos: d.duracionSegundos,
    respuestas: respuestasCanonicasV1(d),
    ubicacion: ubicacionCanonica(d.ubicacion),
    dispositivo: {
      plataforma: d.dispositivo.plataforma,
      modelo: d.dispositivo.modelo,
      versionSistema: d.dispositivo.versionSistema,
    },
    versionAplicacion: d.versionAplicacion,
  });
}

/** sha256 hex de la forma canónica. Es lo que se guarda en `payloadHash`. */
export function hashEncuestaV1(d: EncuestaV1): string {
  return createHash('sha256').update(canonicalizarEncuestaV1(d), 'utf8').digest('hex');
}

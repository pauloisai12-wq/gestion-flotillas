// Payloads de referencia de la ingesta de Encuestas Okrean, compartidos por todo
// el sprint 5 (validador, hash canónico, servicio y HTTP). Devuelven el body TAL
// COMO VIAJA POR EL CABLE: JSON plano, fechas en texto ISO y los campos que el
// teléfono usa para su propia cola de envío (estadoSincronizacion y compañía),
// que el validador estripa. Nada de Dates ni de objetos ya parseados: si los
// fixtures fueran "limpios", ningún test probaría el strip.
//
// El merge de `overrides` es SUPERFICIAL a propósito: para tocar un campo
// anidado (respuestas.partidoPreferido, ubicacion.esValida) el test compone el
// sub-objeto entero y así se ve en el propio test qué queda dentro.

/** Body de la ingesta antes de validar: JSON arbitrario, sin tipar de más. */
export type PayloadEncuesta = Record<string, unknown>;

/** Copia profunda por JSON — basta porque estos payloads son JSON puro. */
export function deepClone<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

/** Devuelve una copia del payload sin las claves indicadas (top-level). */
export function sinClaves(payload: PayloadEncuesta, ...claves: string[]): PayloadEncuesta {
  const copia = { ...payload };
  for (const clave of claves) delete copia[clave];
  return copia;
}

const DISPOSITIVO = { plataforma: 'android', modelo: 'Moto G54', versionSistema: '14' };

// Los cuatro campos de la cola de envío del teléfono. No se declaran en el
// schema, así que no llegan al hash ni a la BD (solo a payloadRaw).
const SINCRONIZACION = {
  estadoSincronizacion: 'pendiente',
  numeroIntentosSincronizacion: 0,
  fechaUltimoIntento: null,
  fechaSincronizacion: null,
};

/**
 * Encuesta v3 completada: inicio 10:00:00Z, fin 10:06:40Z ⇒ 400 s, que es justo
 * lo que declara duracionSegundos (dentro de la tolerancia). Todos los campos de
 * respuestas son obligatorios en v3; no hay rama noElegible.
 */
export function encuestaCompletaValida(overrides: PayloadEncuesta = {}): PayloadEncuesta {
  return {
    idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    folioLocal: 'LX-1042',
    encuestador: 'María López',
    versionCuestionario: 3,
    estado: 'completada',
    fechaHoraInicio: '2026-08-01T10:00:00.000Z',
    fechaHoraFinalizacion: '2026-08-01T10:06:40.000Z',
    duracionSegundos: 400,
    respuestas: {
      sexo: 'mujer',
      rangoEdad: '31_45',
      empresariosConocidos: ['Juan Pérez'],
      politicosConocidos: ['Lalo Ximénez', 'Irineo Molina'],
      conoceLalo: 'si',
      rolLalo: 'politico_lider_social',
      opinionLalo: 'buena',
      preferenciaElectoral: 'lalo_ximenez',
      preferenciaPartido: 'morena',
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'buena' },
        { gobernante: 'jara', calificacion: 'regular' },
        { gobernante: 'huerta', calificacion: 'mala' },
      ],
    },
    ubicacion: {
      disponible: true,
      latitud: 19.432608,
      longitud: -99.133209,
      precisionMetros: 12.5,
      fechaHoraCaptura: '2026-08-01T10:05:00.000Z',
      permiso: 'concedido',
      servicioActivo: true,
      esValida: true,
    },
    dispositivo: { ...DISPOSITIVO },
    versionAplicacion: '2.0.0',
    ...SINCRONIZACION,
    ...overrides,
  };
}

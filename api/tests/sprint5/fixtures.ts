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

/**
 * Encuesta v1 completada y elegible: inicio 10:00:00Z, fin 10:06:40Z ⇒ 400 s, que
 * es justo lo que declara duracionSegundos (dentro de la tolerancia).
 * P5 tiene tres personas conocidas, así que P6 va respondida.
 */
export function encuestaV1CompletaValida(overrides: PayloadEncuesta = {}): PayloadEncuesta {
  return {
    idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    folioLocal: 'LX-1042',
    encuestador: 'María López',
    versionCuestionario: 1,
    estado: 'completada',
    elegibilidad: 'elegible',
    fechaHoraInicio: '2026-07-30T10:00:00.000Z',
    fechaHoraFinalizacion: '2026-07-30T10:06:40.000Z',
    duracionSegundos: 400,
    respuestas: {
      credencialVigente: 'si',
      rangoEdad: '30_44',
      genero: 'mujer',
      partidoPreferido: 'morena',
      conocimientoPorPersona: [
        { persona: 'lalo_ximenez', nivel: 'bien' },
        { persona: 'laura_estrada', nivel: 'algo' },
        { persona: 'paco_nino', nivel: 'poco' },
        { persona: 'gabriela_delgado', nivel: 'no_conoce' },
        { persona: 'irineo_molina', nivel: 'no_conoce' },
        { persona: 'goyo_castaneda', nivel: 'no_conoce' },
        { persona: 'ernesto_montero', nivel: 'no_conoce' },
      ],
      mediosConocimiento: { tipo: 'respondida', medios: ['redes_sociales', 'labor_social'] },
      mayorPersonalidad: 'lalo_ximenez',
      candidatoPreferido: 'laura_estrada',
    },
    ubicacion: {
      disponible: true,
      latitud: 19.432608,
      longitud: -99.133209,
      precisionMetros: 12.5,
      fechaHoraCaptura: '2026-07-30T10:05:00.000Z',
      permiso: 'concedido',
      servicioActivo: true,
      esValida: true,
    },
    dispositivo: { ...DISPOSITIVO },
    versionAplicacion: '1.0.3',
    ...SINCRONIZACION,
    ...overrides,
  };
}

/**
 * Encuesta v1 cortada en P1 (credencial no vigente): sin P2–P8, con la ubicación
 * declarada como NO disponible por permiso denegado. Dura 22 s.
 */
export function encuestaV1NoElegibleValida(overrides: PayloadEncuesta = {}): PayloadEncuesta {
  return {
    idLocal: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    folioLocal: 'LX-1043',
    encuestador: 'María López',
    versionCuestionario: 1,
    estado: 'noElegible',
    elegibilidad: 'noElegible',
    fechaHoraInicio: '2026-07-30T11:00:00.000Z',
    fechaHoraFinalizacion: '2026-07-30T11:00:22.000Z',
    duracionSegundos: 22,
    respuestas: {
      credencialVigente: 'no',
      conocimientoPorPersona: [],
    },
    ubicacion: {
      disponible: false,
      permiso: 'denegado',
      servicioActivo: true,
      motivoNoDisponible: 'permisoDenegado',
    },
    dispositivo: { ...DISPOSITIVO },
    versionAplicacion: '1.0.3',
    ...SINCRONIZACION,
    ...overrides,
  };
}

/**
 * Encuesta v4 completada: igual a v3 pero con catálogos extendidos y campos
 * opcionales de texto libre. Con códigos normales (sin "otro", sin textos).
 * Los casos excepcionales se construyen en cada test con overrides de respuestas.
 */
export function encuestaV4CompletaValida(overrides: PayloadEncuesta = {}): PayloadEncuesta {
  return {
    idLocal: '4a8e7f9b-3c2d-4e1f-8a5b-9c7d6e1f2a3b',
    folioLocal: 'LX-2024',
    encuestador: 'Carlos Rodríguez',
    versionCuestionario: 4,
    estado: 'completada',
    fechaHoraInicio: '2026-08-02T14:00:00.000Z',
    fechaHoraFinalizacion: '2026-08-02T14:07:30.000Z',
    duracionSegundos: 450,
    respuestas: {
      sexo: 'hombre',
      rangoEdad: '46_mas',
      empresariosConocidos: [],
      politicosConocidos: ['Lalo Ximénez'],
      conoceLalo: 'si',
      rolLalo: 'empresario',
      opinionLalo: 'muy_buena',
      preferenciaElectoral: 'lalo_ximenez',
      preferenciaPartido: 'morena',
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'muy_buena' },
        { gobernante: 'jara', calificacion: 'buena' },
        { gobernante: 'huerta', calificacion: 'regular' },
      ],
    },
    ubicacion: {
      disponible: true,
      latitud: 20.123456,
      longitud: -98.654321,
      precisionMetros: 18.3,
      fechaHoraCaptura: '2026-08-02T14:06:00.000Z',
      permiso: 'concedido',
      servicioActivo: true,
      esValida: true,
    },
    dispositivo: { ...DISPOSITIVO },
    versionAplicacion: '2.1.0',
    ...SINCRONIZACION,
    ...overrides,
  };
}

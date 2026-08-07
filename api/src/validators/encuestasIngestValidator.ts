// Validación del POST /api/v1/encuestas: la ingesta de la app móvil "Encuestas
// Okrean" (módulo propio, sin relación con GeoCampo/qa_externa). Es la cara de
// DISPOSITIVO, así que usa el subpath plano de zod + safeParse manual en el
// router, igual que qaExternaValidator.ts y qaExternaPersonaValidator.ts; la
// cara JWT del revisor usa zod/v4 + validateQuery y las dos no se mezclan.
//
// DIFERENCIA CLAVE con qaExternaPersonaValidator.ts: allí el mismo endpoint
// atiende multipart, donde TODO campo llega como string, y por eso los números
// se coercen. Aquí la ingesta es JSON puro, así que los números se validan
// ESTRICTOS: `z.number()` a secas, sin `z.coerce` y sin la unión number|string.
// Un `"400"`, un `null` o un `true` donde se espera un número son rechazo, no un
// 0 silencioso. Lo mismo vale para booleanos y fechas: nada se adivina.
//
// Lo que este schema deja pasar es EXACTAMENTE lo que se hashea
// (lib/encuestasCanonical.ts) y lo que se persiste. Los campos que el teléfono
// usa para su propia cola de envío (estadoSincronizacion,
// numeroIntentosSincronizacion, fechaUltimoIntento, fechaSincronizacion) y el
// idRemoto que le devolvió el servidor NO se declaran: zod los estripa, así que
// no pueden alterar el hash de idempotencia ni acabar en columnas. El body tal
// como llegó se conserva aparte, en payloadRaw.
//
// Aquí conviven los DOS cuestionarios que el servidor sabe recibir: el v3
// vigente y el v1 restaurado (la app móvil sigue mandando ambos). Cada uno tiene
// su schema y sus catálogos; nada se comparte salvo los helpers, la ubicación y
// la coherencia de fechas/duración, que son idénticos entre versiones.
//
// Dos cosas que a propósito NO viven aquí:
//  - el dispatch por versión de cuestionario: una versión ∉ {1, 3} se responde
//    422 UNSUPPORTED_VERSION en el router, antes de tocar estos schemas;
//  - la forma del error: el router responde 422 inline con las issues y nunca
//    relanza el ZodError (el handler global lo convertiría en 400).
//
// Requiere zod 4: las ramas de las uniones discriminadas llevan .superRefine(),
// y en zod 3 eso las envolvería en ZodEffects, que discriminatedUnion rechaza.

import { z } from 'zod';

// UUID genérico (cualquier versión); la app manda v4. Copia local a propósito:
// el módulo de encuestas no importa nada de qa_externa para poder borrarse
// entero sin tocar GeoCampo.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Folio del talonario impreso del encuestador: prefijo fijo + consecutivo. NO es
// único en BD — dos teléfonos con talonarios distintos repiten folio de forma
// legítima; la clave de idempotencia es idLocal.
export const FOLIO_LOCAL_RE = /^LX-[0-9]+$/;

// Catálogos de la versión 3 del cuestionario. Viven en la app (TEXT validado
// aquí, no enums de Postgres) para que una v4 no exija ALTER TYPE.
export const SEXOS_V3 = ['hombre', 'mujer'] as const;
export const RANGOS_EDAD_V3 = ['18_30', '31_45', '46_mas'] as const;
export const SI_NO_V3 = ['si', 'no'] as const;
export const ROLES_LALO_V3 = [
  'politico_lider_social',
  'empresario',
  'funcionario_publico',
  'no_sabe_no_contesta',
] as const;
export const OPINIONES_LALO_V3 = [
  'muy_buena', 'buena', 'regular', 'mala', 'muy_mala', 'no_lo_conozco',
] as const;
export const PREFERENCIAS_ELECTORALES_V3 = [
  'lalo_ximenez', 'irineo_molina', 'fernando_huerta', 'paola_barrera', 'ana_gabriela_delgado',
] as const;
export const PARTIDOS_V3 = [
  'pri', 'morena', 'pan', 'panal_oaxaca', 'pt', 'prd_oaxaca', 'pvem', 'pto', 'mc',
] as const;
export const GOBERNANTES_V3 = ['sheinbaum', 'jara', 'huerta'] as const;
export const CALIFICACIONES_V3 = ['muy_buena', 'buena', 'regular', 'mala', 'muy_mala'] as const;

// Catálogos de la versión 1 del cuestionario. Viven en la app (TEXT validado
// aquí, no enums de Postgres) igual que los de la v3. Los valores son EXACTOS a
// los del histórico: la app móvil ya los habla y los hashes ya guardados tienen
// que seguir coincidiendo. Son disjuntos de los de la v3 salvo por coincidencias
// inocuas (`morena`, `hombre`), y `versionCuestionario` desambigua la fila.
export const PERSONAS_V1 = [
  'lalo_ximenez',
  'laura_estrada',
  'paco_nino',
  'gabriela_delgado',
  'irineo_molina',
  'goyo_castaneda',
  'ernesto_montero',
] as const;

export const NIVELES_CONOCIMIENTO_V1 = ['no_conoce', 'poco', 'algo', 'bien'] as const;

export const MEDIOS_V1 = ['redes_sociales', 'otras_personas', 'labor_social'] as const;

export const PARTIDOS_V1 = [
  'morena',
  'pri',
  'ninguno_no_sabe',
  'prd',
  'mc',
  'pvem',
  'pt',
  'independiente',
  'panal',
  'pan',
] as const;

export const RANGOS_EDAD_V1 = ['18_29', '30_44', '45_59', '60_mas'] as const;

export const GENEROS_V1 = ['hombre', 'mujer', 'otro'] as const;

/**
 * Desfase máximo tolerado entre `duracionSegundos` (cronómetro de la app) y el
 * intervalo `fechaHoraFinalizacion − fechaHoraInicio`. Absorbe el desfase de
 * reloj y el redondeo del teléfono sin dejar pasar duraciones inventadas.
 */
export const TOLERANCIA_DURACION_SEG = 60;

// Umbral con el que la app decide si la lectura de GPS sirve. Se revalida aquí
// porque `esValida` la manda el cliente y no puede contradecir a su propia
// precisión.
const PRECISION_VALIDA_MAX_M = 50;

/** Fecha ISO-8601 en texto → Date. Sin coerce: un número o un null es rechazo. */
const fechaIso = (campo: string) =>
  z
    .string({ error: `${campo} debe ser una fecha ISO-8601 en texto` })
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: `${campo} no es una fecha ISO-8601 válida`,
    })
    .transform((s) => new Date(s));

const textoCorto = (max: number, campo: string) =>
  z
    .string({ error: `${campo} es obligatorio` })
    .trim()
    .min(1, `${campo} es obligatorio`)
    .max(max, `${campo} no puede exceder ${max} caracteres`);

// ---------------------------------------------------------------------------
// Listas de nombres tecleados por el encuestador (empresarios, políticos)
// ---------------------------------------------------------------------------

// Lista de nombres tecleados por el encuestador. Texto libre: se recorta y se
// acota, pero no hay catálogo ni control de duplicados (dos personas pueden
// llamarse igual).
const listaDeNombres = (campo: string, min: number) =>
  z
    .array(
      z
        .string({ error: `cada entrada de ${campo} debe ser texto` })
        .trim()
        .min(1, `las entradas de ${campo} no pueden ir vacías`)
        .max(80, `cada entrada de ${campo} no puede exceder 80 caracteres`),
      { error: `${campo} es obligatorio` },
    )
    // Con min 0 el .min() nunca dispara; el mensaje solo importa para políticos.
    .min(min, `${campo} debe traer al menos ${min} entrada`)
    .max(3, `${campo} no puede traer más de 3 entradas`);

// ---------------------------------------------------------------------------
// P10 — aprobación por gobernante
// ---------------------------------------------------------------------------

// P10 — aprobación por gobernante: exactamente los 3 del catálogo, sin repetir.
const aprobacionPorGobernanteSchema = z
  .array(
    z.object({
      gobernante: z.enum(GOBERNANTES_V3, { error: 'gobernante fuera del catálogo de la versión 3' }),
      calificacion: z.enum(CALIFICACIONES_V3, { error: 'calificacion fuera del catálogo de la versión 3' }),
    }),
  )
  .length(3, 'aprobacionPorGobernante debe traer los 3 gobernantes del catálogo v3')
  .superRefine((filas, ctx) => {
    // El check corre aunque el parseo previo haya fallado: comprobar la forma
    // antes de recorrer (mismo criterio que el conocimientoPorPersona de v1).
    if (!Array.isArray(filas)) return;
    const distintos = new Set(filas.map((f) => f?.gobernante));
    if (distintos.size !== filas.length) {
      ctx.addIssue({ code: 'custom', message: 'aprobacionPorGobernante no puede repetir gobernantes' });
    }
  });

// ---------------------------------------------------------------------------
// Bloque de respuestas v3
// ---------------------------------------------------------------------------

// Bloque de respuestas v3: TODOS los campos obligatorios, sin saltos de lógica.
// rolLalo y opinionLalo se contestan siempre (sus catálogos ya traen
// no_sabe_no_contesta / no_lo_conozco), así que NO hay coherencia cruzada con
// conoceLalo que validar.
const respuestasV3Schema = z.object({
  sexo: z.enum(SEXOS_V3, { error: 'sexo fuera del catálogo de la versión 3' }),
  rangoEdad: z.enum(RANGOS_EDAD_V3, { error: 'rangoEdad fuera del catálogo de la versión 3' }),
  empresariosConocidos: listaDeNombres('empresariosConocidos', 0),
  politicosConocidos: listaDeNombres('politicosConocidos', 1),
  conoceLalo: z.enum(SI_NO_V3, { error: 'conoceLalo debe ser si o no' }),
  rolLalo: z.enum(ROLES_LALO_V3, { error: 'rolLalo fuera del catálogo de la versión 3' }),
  opinionLalo: z.enum(OPINIONES_LALO_V3, { error: 'opinionLalo fuera del catálogo de la versión 3' }),
  preferenciaElectoral: z.enum(PREFERENCIAS_ELECTORALES_V3, {
    error: 'preferenciaElectoral fuera del catálogo de la versión 3',
  }),
  preferenciaPartido: z.enum(PARTIDOS_V3, {
    error: 'preferenciaPartido fuera del catálogo de la versión 3',
  }),
  aprobacionPorGobernante: aprobacionPorGobernanteSchema,
});

// ---------------------------------------------------------------------------
// Ubicación (sin cambios entre v1 y v3)
// ---------------------------------------------------------------------------

const ubicacionDisponibleSchema = z
  .object({
    disponible: z.literal(true),
    latitud: z
      .number()
      .min(-90, 'latitud debe estar entre -90 y 90')
      .max(90, 'latitud debe estar entre -90 y 90'),
    longitud: z
      .number()
      .min(-180, 'longitud debe estar entre -180 y 180')
      .max(180, 'longitud debe estar entre -180 y 180'),
    // .finite() explícito: es el candado de que Infinity nunca pase por aquí,
    // independientemente de lo que z.number() acepte por defecto.
    precisionMetros: z.number().finite().min(0, 'precisionMetros no puede ser negativa'),
    fechaHoraCaptura: fechaIso('ubicacion.fechaHoraCaptura'),
    permiso: z.literal('concedido'),
    servicioActivo: z.literal(true),
    esValida: z.boolean(),
  })
  .superRefine((u, ctx) => {
    // esValida la calcula el teléfono; aquí se recalcula para que no pueda
    // marcar como buena una lectura de 200 m (ni descartar una de 5 m).
    if (typeof u.precisionMetros !== 'number' || typeof u.esValida !== 'boolean') return;
    if (u.esValida !== (u.precisionMetros <= PRECISION_VALIDA_MAX_M)) {
      ctx.addIssue({
        code: 'custom',
        path: ['esValida'],
        message: `esValida debe ser true exactamente cuando precisionMetros <= ${PRECISION_VALIDA_MAX_M}`,
      });
    }
  });

const ubicacionNoDisponibleSchema = z
  .object({
    disponible: z.literal(false),
    permiso: z.enum(['concedido', 'denegado', 'noSolicitado'], {
      error: 'ubicacion.permiso fuera del catálogo',
    }),
    servicioActivo: z.boolean(),
    motivoNoDisponible: z.enum(
      ['permisoDenegado', 'servicioDesactivado', 'errorTemporal', 'omitidaPorEncuestador'],
      { error: 'ubicacion.motivoNoDisponible fuera del catálogo' },
    ),
  })
  .superRefine((u, ctx) => {
    // El motivo tiene que ser compatible con el estado que lo explica: si no,
    // el dato de por qué falta la ubicación no vale para nada.
    if (u.motivoNoDisponible === 'permisoDenegado' && u.permiso === 'concedido') {
      ctx.addIssue({
        code: 'custom',
        path: ['motivoNoDisponible'],
        message: 'permisoDenegado es incompatible con permiso concedido',
      });
    }
    if (u.motivoNoDisponible === 'servicioDesactivado' && u.servicioActivo !== false) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivoNoDisponible'],
        message: 'servicioDesactivado exige servicioActivo en false',
      });
    }
    if (
      u.permiso === 'concedido' &&
      u.servicioActivo === true &&
      u.motivoNoDisponible !== 'errorTemporal' &&
      u.motivoNoDisponible !== 'omitidaPorEncuestador'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivoNoDisponible'],
        message:
          'con permiso concedido y servicio activo el motivo solo puede ser errorTemporal u omitidaPorEncuestador',
      });
    }
  });

const ubicacionSchema = z.discriminatedUnion('disponible', [
  ubicacionDisponibleSchema,
  ubicacionNoDisponibleSchema,
]);

// ---------------------------------------------------------------------------
// Coherencia fechas/duración (idéntica en v1 y v3)
// ---------------------------------------------------------------------------

/**
 * Refinamiento compartido por los dos cuestionarios: la finalización no puede
 * ser anterior al inicio y `duracionSegundos` tiene que concordar con el
 * intervalo dentro de la tolerancia. Los campos se tipan `unknown` porque el
 * check corre aunque el parseo previo haya fallado (y entonces una fecha sigue
 * siendo string): se valida la forma antes de operar.
 */
function coherenciaFechasDuracion(
  d: { fechaHoraInicio: unknown; fechaHoraFinalizacion: unknown; duracionSegundos: unknown },
  ctx: z.core.$RefinementCtx,
): void {
  const inicio = d.fechaHoraInicio;
  const fin = d.fechaHoraFinalizacion;
  if (
    !(inicio instanceof Date) ||
    !(fin instanceof Date) ||
    Number.isNaN(inicio.getTime()) ||
    Number.isNaN(fin.getTime())
  ) {
    return;
  }
  if (fin.getTime() < inicio.getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['fechaHoraFinalizacion'],
      message: 'fechaHoraFinalizacion no puede ser anterior a fechaHoraInicio',
    });
    // Sin intervalo válido la comprobación de duración no aporta información.
    return;
  }
  if (typeof d.duracionSegundos !== 'number' || !Number.isFinite(d.duracionSegundos)) return;
  const intervaloSeg = (fin.getTime() - inicio.getTime()) / 1000;
  if (Math.abs(d.duracionSegundos - intervaloSeg) > TOLERANCIA_DURACION_SEG) {
    ctx.addIssue({
      code: 'custom',
      path: ['duracionSegundos'],
      message: `duracionSegundos no concuerda con el intervalo de la encuesta (tolerancia ${TOLERANCIA_DURACION_SEG} s)`,
    });
  }
}

// ---------------------------------------------------------------------------
// Encuesta v3
// ---------------------------------------------------------------------------

const camposComunes = {
  idLocal: z.string().regex(UUID_RE, 'idLocal debe tener forma de UUID'),
  folioLocal: z
    .string()
    .regex(FOLIO_LOCAL_RE, 'folioLocal debe tener la forma LX-<número>')
    .optional(),
  // Nombre de quien levanta la encuesta. OPCIONAL por retrocompatibilidad: los
  // registros capturados antes de actualizar la app no lo traen, igual que pasa
  // con `ubicacion`. Y como allí, AUSENTE se acepta pero `null` NO: si el dato
  // no se conoce, se omite la clave. No se usa textoCorto() porque su mensaje
  // ("es obligatorio") mentiría sobre un campo que sí se puede omitir.
  encuestador: z
    .string({ error: 'encuestador debe ser texto' })
    .trim()
    .min(1, 'encuestador no puede ir vacío: si no se conoce, omite la clave')
    .max(120, 'encuestador no puede exceder 120 caracteres')
    .optional(),
  // El bloque lo comparten las dos versiones, así que las ramas v1 sobrescriben
  // esta clave con su literal(1) después del spread.
  versionCuestionario: z.literal(3),
  fechaHoraInicio: fechaIso('fechaHoraInicio'),
  fechaHoraFinalizacion: fechaIso('fechaHoraFinalizacion'),
  duracionSegundos: z
    .number()
    .int('duracionSegundos debe ser un entero')
    .min(0, 'duracionSegundos no puede ser negativa'),
  // AUSENTE se acepta (registro capturado por una versión de la app sin GPS);
  // `null` NO: un bloque explícitamente vacío no dice lo mismo que uno que nunca
  // existió, y la columna ubicacionDisponible distingue los dos casos.
  ubicacion: ubicacionSchema.optional(),
  dispositivo: z.object({
    plataforma: textoCorto(120, 'dispositivo.plataforma'),
    modelo: textoCorto(120, 'dispositivo.modelo'),
    versionSistema: textoCorto(120, 'dispositivo.versionSistema'),
  }),
  versionAplicacion: textoCorto(60, 'versionAplicacion'),
};

export const encuestaV3Schema = z
  .object({
    ...camposComunes,
    estado: z.literal('completada'),
    respuestas: respuestasV3Schema,
  })
  .superRefine(coherenciaFechasDuracion);

export type EncuestaV3 = z.infer<typeof encuestaV3Schema>;

// ---------------------------------------------------------------------------
// Cuestionario v1 (restaurado)
// ---------------------------------------------------------------------------
// Contrato EXACTO al histórico: mismos nombres de campos, catálogos y mensajes,
// porque la app móvil ya lo habla y los registros v1 ya hasheados tienen que
// seguir dando el mismo hash. Lo único que NO se restauró es su copia de la
// ubicación y de los helpers: se reutilizan los compartidos de arriba, que son
// idénticos carácter por carácter a los del v1 original.

const personaV1 = z.enum(PERSONAS_V1, {
  error: 'persona fuera del catálogo de la versión 1',
});

// ---------------------------------------------------------------------------
// P5 — conocimiento por persona
// ---------------------------------------------------------------------------

const conocimientoPorPersonaSchema = z
  .array(
    z.object({
      persona: personaV1,
      nivel: z.enum(NIVELES_CONOCIMIENTO_V1, {
        error: 'nivel de conocimiento fuera del catálogo de la versión 1',
      }),
    }),
  )
  .length(7, 'conocimientoPorPersona debe traer las 7 personas del catálogo v1')
  .superRefine((filas, ctx) => {
    // Los checks corren aunque el parseo previo haya fallado, así que se
    // comprueba la forma antes de recorrer (un `"x"` en vez de un array haría
    // estallar safeParse en lugar de devolver el 422).
    if (!Array.isArray(filas)) return;
    // El enum ya descarta personas desconocidas y .length(7) fija el tamaño: si
    // además no hay repetidas, las 7 son exactamente las 7 del catálogo.
    const distintas = new Set(filas.map((f) => f?.persona));
    if (distintas.size !== filas.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'conocimientoPorPersona no puede repetir personas',
      });
    }
  });

// ---------------------------------------------------------------------------
// P6 — medios por los que las conoce
// ---------------------------------------------------------------------------

const mediosConocimientoSchema = z.discriminatedUnion('tipo', [
  // La app salta P6 cuando P5 dice que no conoce a nadie; el registro lo declara
  // en vez de mandar una lista vacía, que sería ambigua.
  z.object({ tipo: z.literal('omitidaPorLogica') }),
  z.object({
    tipo: z.literal('respondida'),
    medios: z
      .array(z.enum(MEDIOS_V1, { error: 'medio fuera del catálogo de la versión 1' }))
      .min(1, 'medios debe traer al menos un medio')
      .max(MEDIOS_V1.length, `medios no puede traer más de ${MEDIOS_V1.length} entradas`)
      .superRefine((medios, ctx) => {
        if (!Array.isArray(medios)) return;
        if (new Set(medios).size !== medios.length) {
          ctx.addIssue({ code: 'custom', message: 'medios no puede repetir valores' });
        }
      }),
  }),
]);

// ---------------------------------------------------------------------------
// Bloque de respuestas v1 por rama
// ---------------------------------------------------------------------------

const respuestasCompletadaV1Schema = z
  .object({
    credencialVigente: z.literal('si'),
    rangoEdad: z.enum(RANGOS_EDAD_V1, { error: 'rangoEdad fuera del catálogo de la versión 1' }),
    genero: z.enum(GENEROS_V1, { error: 'genero fuera del catálogo de la versión 1' }),
    partidoPreferido: z.enum(PARTIDOS_V1, {
      error: 'partidoPreferido fuera del catálogo de la versión 1',
    }),
    conocimientoPorPersona: conocimientoPorPersonaSchema,
    mediosConocimiento: mediosConocimientoSchema,
    mayorPersonalidad: personaV1,
    candidatoPreferido: personaV1,
  })
  .superRefine((r, ctx) => {
    // P6 solo se pregunta si el encuestado conoce a alguien. Las DOS direcciones
    // son rechazo: con medios respondidos sobre gente que dijo no conocer, o con
    // P6 omitida cuando sí conoce a alguien, el registro contradice su propia
    // lógica de captura y ya no es analizable.
    if (!Array.isArray(r.conocimientoPorPersona) || !r.mediosConocimiento) return;
    const conoceAAlguien = r.conocimientoPorPersona.some((f) => f?.nivel !== 'no_conoce');
    const tipo = r.mediosConocimiento.tipo;
    if (conoceAAlguien && tipo !== 'respondida') {
      ctx.addIssue({
        code: 'custom',
        path: ['mediosConocimiento', 'tipo'],
        message: 'mediosConocimiento debe venir respondida si conoce al menos a una persona',
      });
    }
    if (!conoceAAlguien && tipo !== 'omitidaPorLogica') {
      ctx.addIssue({
        code: 'custom',
        path: ['mediosConocimiento', 'tipo'],
        message: 'mediosConocimiento debe venir omitidaPorLogica si no conoce a ninguna persona',
      });
    }
  });

const respuestasNoElegibleV1Schema = z.object({
  credencialVigente: z.literal('no'),
  // P2–P8 no se declaran: si el teléfono manda el borrador previo al "no" de P1,
  // zod lo estripa y esas respuestas no se hashean ni se guardan.
  conocimientoPorPersona: z
    .array(z.never())
    .length(0, 'conocimientoPorPersona debe ir vacío cuando la credencial no está vigente'),
});

// ---------------------------------------------------------------------------
// Encuesta v1
// ---------------------------------------------------------------------------

// `versionCuestionario` va DESPUÉS del spread a propósito: camposComunes trae el
// literal(3) del cuestionario vigente y aquí se sobrescribe con el 1.
const ramaCompletadaV1 = z.object({
  ...camposComunes,
  versionCuestionario: z.literal(1),
  estado: z.literal('completada'),
  elegibilidad: z.literal('elegible'),
  respuestas: respuestasCompletadaV1Schema,
});

const ramaNoElegibleV1 = z.object({
  ...camposComunes,
  versionCuestionario: z.literal(1),
  estado: z.literal('noElegible'),
  elegibilidad: z.literal('noElegible'),
  respuestas: respuestasNoElegibleV1Schema,
});

export const encuestaV1Schema = z
  .discriminatedUnion('estado', [ramaCompletadaV1, ramaNoElegibleV1])
  .superRefine(coherenciaFechasDuracion);

export type EncuestaV1 = z.infer<typeof encuestaV1Schema>;

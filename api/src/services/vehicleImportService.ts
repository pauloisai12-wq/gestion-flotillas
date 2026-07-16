// /api/src/services/vehicleImportService.ts
// Importa vehículos desde Excel/CSV — upsert por economicNumber o expedientNumber

import * as XLSX from 'xlsx';
import prisma, { type Tx } from '../lib/prisma';
import { Prisma, VehicleClassification } from '@prisma/client';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { logger } from '../lib/logger';
import { deactivateVehicleInTransaction } from './vehicleDeactivationService';
import { businessPeriodForDate } from '../lib/businessTime';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string; data?: Record<string, unknown> }[];
  // Avisos no fatales: p.ej. una clave única REAL (placa/económico/expediente)
  // que ya existía y se guardó desambiguada con sufijo -DUP- (revisar duplicado).
  warnings: { row: number; message: string }[];
}

interface ImportOptions {
  maxRows?: number;
  actorUserId?: number;
  onProgress?: (progress: number) => Promise<void> | void;
}

type ImportMatrix = unknown[][];

const DEFAULT_MAX_IMPORT_ROWS = 10_000;
const LOOKUP_BATCH_SIZE = 500;
const MAX_PUBLIC_IMPORT_ERROR_LENGTH = 500;
const UNEXPECTED_IMPORT_ROW_MESSAGE =
  'No se pudo guardar esta fila por un error interno; revisa los datos o intenta de nuevo.';
const UNEXPECTED_IMPORT_JOB_MESSAGE =
  'No se pudo completar la importación por un error interno. Intenta de nuevo o contacta a soporte.';

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportValidationError';
  }
}

export function publicImportErrorMessage(
  error: unknown,
  scope: 'row' | 'job' = 'job',
): string {
  if (error instanceof ImportValidationError) {
    return error.message.slice(0, MAX_PUBLIC_IMPORT_ERROR_LENGTH);
  }
  return scope === 'row' ? UNEXPECTED_IMPORT_ROW_MESSAGE : UNEXPECTED_IMPORT_JOB_MESSAGE;
}
const PARSER_TIMEOUT_MS = 120_000;

// Mapeo flexible de nombres de columnas → campo del modelo
// Soporta variaciones comunes (mayúsculas, acentos, abreviaciones)
function normalizeKey(k: string): string {
  return String(k ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita marcas diacríticas combinables
    .replace(/[^a-z0-9]/g, '');
}

const FIELD_MAP: Record<string, string> = {
  // Identificadores
  'noexp': 'expedientNumber',
  'numexp': 'expedientNumber',
  'expediente': 'expedientNumber',
  'placa': 'plate',
  'placaactual': 'plate',
  'placaanterior': 'previousPlate',
  'noeconomico': 'economicNumber',
  'numeconomico': 'economicNumber',
  'economico': 'economicNumber',
  // Identidad
  'marca': 'brand',
  'tipo': 'vehicleTypeName',          // resuelve nombre → id
  'clasedelvehiculo': 'vehicleClass',
  'clasevehiculo': 'vehicleClass',
  'clase': 'vehicleClass',
  'uso': 'usage',
  'color': 'color',
  'mod': 'year',
  'modelo': 'year',
  'ano': 'year',
  // En inventarios MX "MODELO" suele ser el AÑO (de ahí el mapeo de arriba). El
  // nombre/submodelo del vehículo (Vehicle.model) viene en columnas aparte; sin
  // estos alias el campo quedaba siempre en 'SIN DATO'.
  'submodelo': 'model',
  'version': 'model',
  'linea': 'model',
  'motor': 'engineNumber',
  'nomotor': 'engineNumber',
  'serie': 'vin',
  'vin': 'vin',
  'cilin': 'cylinders',
  'cilindros': 'cylinders',
  // Operativo
  'estatus': '_status',                // alta/baja → isActive
  'estatusfisicoactual': 'physicalCondition',
  'estadofisicoactual': 'physicalCondition',
  'uejec': 'executiveUnit',
  'unidadejecutiva': 'executiveUnit',
  'area': 'area',
  // Resguardante (operador asignado)
  'resguardante': '_resguardanteName',
  // Vigencias
  'ultimoanoasegurado': 'lastInsuredYear',
  'anoasegurado': 'lastInsuredYear',
  'ultimatenencia': 'lastTenenciaYear',
  'tenencia': 'lastTenenciaYear',
  'ultimoresguardo': 'lastResguardoDate',
  'certificacionfactura': 'invoiceCertifiedAt',
  // Notas
  'observaciones': '_observations',
};

function classifyFromUsage(usage: string | undefined): VehicleClassification | undefined {
  if (!usage) return undefined;
  const u = usage.toLowerCase();
  if (u.includes('polic')) return 'POLICIAL';
  if (u.includes('vial')) return 'VIAL';
  if (u.includes('estatal') || u.includes('gobierno')) return 'ESTATAL';
  return undefined;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S));
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseInt(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Extrae el AÑO de un valor que puede venir como número (2020), fecha completa
 * (01/01/2020), o timestamp en ms. Maneja INT4 overflow.
 */
function parseYear(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    return y >= 1900 && y < 2100 ? y : null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    // Quizás es texto: "2020"
    const m = String(v).match(/(\d{4})/);
    return m ? parseInt(m[1]) : null;
  }
  // Es un timestamp en ms (típico cuando Excel guarda fecha)
  if (n > 9999) {
    const d = new Date(n);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      return y >= 1900 && y < 2100 ? y : null;
    }
    return null;
  }
  // YY → 20YY
  if (n > 0 && n < 100) return 2000 + Math.trunc(n);
  return Math.trunc(n);
}

function parseString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Detecta automáticamente la fila que contiene los encabezados reales.
 * Busca la primera fila que tenga al menos 3 columnas con keywords conocidos.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectHeaderRow(matrix: any[][]): number {
  const HEADER_KEYWORDS = [
    'placa', 'economico', 'expediente', 'exped', 'marca', 'tipo', 'serie',
    'motor', 'color', 'estatus', 'observac', 'resguard', 'area', 'uejec',
    'tenencia', 'asegur', 'factura', 'cilin', 'clase',
  ];
  const maxScan = Math.min(matrix.length, 20); // primeras 20 filas
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] || [];
    let matches = 0;
    for (const cell of row) {
      const norm = normalizeKey(cell);
      if (!norm) continue;
      if (HEADER_KEYWORDS.some((kw) => norm.includes(kw))) {
        matches++;
        if (matches >= 3) return i;
      }
    }
  }
  return 0; // fallback a primera fila
}

/**
 * Crea un Vehicle con retry inteligente: si falla por unique constraint,
 * ajusta el campo conflictivo con sufijo único y reintenta (hasta 5 veces).
 */
// db: cliente transaccional (tx) o el prisma global — inyectado para permitir
// atomicidad por fila y testeo. warnings: registra desambiguaciones visibles.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeCreate(db: Tx, data: any, rowNumber: number, warnings: ImportResult['warnings']): Promise<any> {
  let attempt = 0;
  // En PostgreSQL, un INSERT que viola un unique constraint (P2002) aborta TODA
  // la transacción: cualquier comando posterior en la misma tx falla con
  // 25P02 ("current transaction is aborted, commands ignored..."). Para poder
  // reintentar con el dato desambiguado marcamos un SAVEPOINT y hacemos
  // ROLLBACK a él tras cada fallo; eso limpia el estado abortado sin descartar
  // la transacción de la fila completa (la asignación/nota siguen siendo atómicas).
  await db.$executeRawUnsafe('SAVEPOINT sp_vehicle');
  while (attempt < 6) {
    try {
      const created = await db.vehicle.create({ data });
      await db.$executeRawUnsafe('RELEASE SAVEPOINT sp_vehicle');
      return created;
    } catch (e) {
      // Volver al savepoint deja la tx en estado válido para el siguiente intento
      // (o para que un throw posterior la revierta limpiamente).
      await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_vehicle');
      attempt++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      if (err.code !== 'P2002' || !err.meta?.target) throw e;
      const target: string[] = Array.isArray(err.meta.target) ? err.meta.target : [err.meta.target];
      const suffix = `-DUP-${rowNumber}${attempt > 1 ? `-${attempt}` : ''}`;

      if (target.includes('vin') && data.vin) {
        warnings.push({ row: rowNumber, message: `VIN '${data.vin}' ya existía; se guardó SIN vin. Revise duplicado.` });
        data.vin = null;  // VIN se puede dejar null
      } else if (target.includes('plate')) {
        const orig = data.plate;
        data.plate = `${(data.plate || 'SIN-PLACA').slice(0, 40)}${suffix}`;
        warnings.push({ row: rowNumber, message: `Placa '${orig}' ya existía; se guardó como '${data.plate}'. Revise duplicado.` });
      } else if (target.includes('expedientNumber') && data.expedientNumber) {
        const orig = data.expedientNumber;
        data.expedientNumber = `${(data.expedientNumber).slice(0, 40)}${suffix}`;
        warnings.push({ row: rowNumber, message: `Expediente '${orig}' ya existía; se guardó como '${data.expedientNumber}'. Revise duplicado.` });
      } else if (target.includes('economicNumber')) {
        const orig = data.economicNumber;
        data.economicNumber = `${(data.economicNumber || 'SIN-ECO').slice(0, 40)}${suffix}`;
        warnings.push({ row: rowNumber, message: `Número económico '${orig}' ya existía; se guardó como '${data.economicNumber}'. Revise duplicado.` });
      } else {
        throw e;  // campo unique desconocido
      }
    }
  }
  throw new ImportValidationError(
    `No se pudo crear la fila ${rowNumber} por identificadores duplicados`,
  );
}

/**
 * Update con manejo de conflictos para campos unique (plate, vin, expedientNumber).
 * Si al actualizar genera duplicado con OTRO registro, nullifica/desambigua el campo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeUpdate(
  db: Tx,
  id: number,
  data: any,
  rowNumber: number,
  warnings: ImportResult['warnings'],
  expected: { isActive: boolean; updatedAt: Date },
): Promise<any> {
  let attempt = 0;
  // Mismo motivo que safeCreate: un UPDATE que genera duplicado (P2002) aborta la
  // transacción en Postgres (25P02). El SAVEPOINT permite reintentar con el campo
  // desambiguado sin perder la transacción de la fila.
  await db.$executeRawUnsafe('SAVEPOINT sp_vehicle');
  while (attempt < 6) {
    try {
      // CAS contra el estado precargado: una baja concurrente no puede quedar
      // deshecha por una importación que empezó cuando la unidad aún estaba activa.
      const updated = await db.vehicle.update({
        where: {
          id,
          isActive: expected.isActive,
          updatedAt: expected.updatedAt,
        },
        data,
      });
      await db.$executeRawUnsafe('RELEASE SAVEPOINT sp_vehicle');
      return updated;
    } catch (e) {
      await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_vehicle');
      attempt++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      if (err.code === 'P2025') {
        throw new ImportValidationError(
          `El vehículo de la fila ${rowNumber} cambió o fue dado de baja durante la importación; vuelve a importar la fila`,
        );
      }
      if (err.code !== 'P2002' || !err.meta?.target) throw e;
      const target: string[] = Array.isArray(err.meta.target) ? err.meta.target : [err.meta.target];
      const suffix = `-DUP-${rowNumber}${attempt > 1 ? `-${attempt}` : ''}`;

      if (target.includes('vin') && data.vin) {
        warnings.push({ row: rowNumber, message: `VIN '${data.vin}' ya existía; se guardó SIN vin. Revise duplicado.` });
        data.vin = null;
      } else if (target.includes('plate')) {
        const orig = data.plate;
        data.plate = `${(data.plate || 'SIN-PLACA').slice(0, 40)}${suffix}`;
        warnings.push({ row: rowNumber, message: `Placa '${orig}' ya existía; se guardó como '${data.plate}'. Revise duplicado.` });
      } else if (target.includes('expedientNumber') && data.expedientNumber) {
        const orig = data.expedientNumber;
        data.expedientNumber = `${(data.expedientNumber).slice(0, 40)}${suffix}`;
        warnings.push({ row: rowNumber, message: `Expediente '${orig}' ya existía; se guardó como '${data.expedientNumber}'. Revise duplicado.` });
      } else {
        throw e;
      }
    }
  }
  throw new ImportValidationError(
    `No se pudo actualizar la fila ${rowNumber} por identificadores duplicados`,
  );
}

const FILE_PARSER_WORKER = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  const XLSX = require('xlsx');
  try {
    const workbook = XLSX.readFile(workerData.filePath, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    if (matrix.length > workerData.maxRows + 21) {
      throw new Error(
        'El archivo excede el máximo de ' + workerData.maxRows + ' filas'
      );
    }
    parentPort.postMessage({ matrix });
  } catch (error) {
    parentPort.postMessage({
      error: error && error.message ? error.message : String(error),
    });
  }
`;

function parseWorkbookFile(filePath: string, maxRows: number): Promise<ImportMatrix> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new ThreadWorker(FILE_PARSER_WORKER, {
      eval: true,
      workerData: { filePath, maxRows },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new ImportValidationError(
        'El archivo tardó demasiado en procesarse; divide la importación',
      ));
    }, PARSER_TIMEOUT_MS);
    worker.once('message', (message: { matrix?: ImportMatrix; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (message.error) reject(new ImportValidationError('No se pudo leer el archivo Excel/CSV'));
      else if (!Array.isArray(message.matrix)) {
        reject(new ImportValidationError('El archivo no contiene una hoja legible'));
      }
      else resolve(message.matrix);
    });
    worker.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new ImportValidationError(
        'El archivo excedió los recursos permitidos para importación',
      ));
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new ImportValidationError(
        code === 0
          ? 'El parser terminó sin producir resultados'
          : 'El archivo no pudo procesarse dentro de los límites permitidos',
      ));
    });
  });
}

export async function importVehiclesFromBuffer(
  buffer: Buffer,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  // Leer como matriz cruda para detectar la fila de encabezados
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
  return importVehiclesFromMatrix(matrix, options);
}

export async function importVehiclesFromFile(
  filePath: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_IMPORT_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > DEFAULT_MAX_IMPORT_ROWS) {
    throw new ImportValidationError(
      `Límite de filas inválido (máximo ${DEFAULT_MAX_IMPORT_ROWS})`,
    );
  }
  const matrix = await parseWorkbookFile(filePath, maxRows);
  return importVehiclesFromMatrix(matrix, options);
}

type ExistingVehicle = {
  id: number;
  economicNumber: string;
  expedientNumber: string | null;
  plate: string;
  vin: string | null;
  isActive: boolean;
  updatedAt: Date;
};

type ExistingVehicleLookup = {
  economicNumber: Map<string, ExistingVehicle>;
  expedientNumber: Map<string, ExistingVehicle>;
  plate: Map<string, ExistingVehicle>;
  vin: Map<string, ExistingVehicle>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeImportRow(raw: Record<string, any>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalized: Record<string, any> = {};
  for (const key in raw) {
    const mapped = FIELD_MAP[normalizeKey(key)];
    if (mapped) normalized[mapped] = raw[key];
  }
  return normalized;
}

async function preloadExistingVehicles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Record<string, any>[],
): Promise<ExistingVehicleLookup> {
  const keys = {
    economicNumber: new Set<string>(),
    expedientNumber: new Set<string>(),
    plate: new Set<string>(),
    vin: new Set<string>(),
  };
  for (const raw of rows) {
    const row = normalizeImportRow(raw);
    const economicNumber = parseString(row.economicNumber);
    const expedientNumber = parseString(row.expedientNumber);
    const plate = parseString(row.plate);
    const vin = parseString(row.vin);
    if (economicNumber) keys.economicNumber.add(economicNumber);
    if (expedientNumber) keys.expedientNumber.add(expedientNumber);
    if (plate) keys.plate.add(plate);
    if (vin) keys.vin.add(vin);
  }

  const arrays = {
    economicNumber: [...keys.economicNumber],
    expedientNumber: [...keys.expedientNumber],
    plate: [...keys.plate],
    vin: [...keys.vin],
  };
  const lookup: ExistingVehicleLookup = {
    economicNumber: new Map(),
    expedientNumber: new Map(),
    plate: new Map(),
    vin: new Map(),
  };
  const maxLength = Math.max(...Object.values(arrays).map((values) => values.length), 0);

  // Una consulta acotada por cada bloque sustituye las cuatro búsquedas por
  // cada fila. Se ejecutan secuencialmente para no agotar el pool de Prisma.
  for (let offset = 0; offset < maxLength; offset += LOOKUP_BATCH_SIZE) {
    const where: Prisma.VehicleWhereInput[] = [];
    const economicNumbers = arrays.economicNumber.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const expedientNumbers = arrays.expedientNumber.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const plates = arrays.plate.slice(offset, offset + LOOKUP_BATCH_SIZE);
    const vins = arrays.vin.slice(offset, offset + LOOKUP_BATCH_SIZE);
    if (economicNumbers.length) where.push({ economicNumber: { in: economicNumbers } });
    if (expedientNumbers.length) where.push({ expedientNumber: { in: expedientNumbers } });
    if (plates.length) where.push({ plate: { in: plates } });
    if (vins.length) where.push({ vin: { in: vins } });
    if (where.length === 0) continue;

    const matches = await prisma.vehicle.findMany({
      where: { OR: where },
      select: {
        id: true,
        economicNumber: true,
        expedientNumber: true,
        plate: true,
        vin: true,
        isActive: true,
        updatedAt: true,
      },
    });
    for (const vehicle of matches) {
      lookup.economicNumber.set(vehicle.economicNumber, vehicle);
      lookup.plate.set(vehicle.plate, vehicle);
      if (vehicle.expedientNumber) lookup.expedientNumber.set(vehicle.expedientNumber, vehicle);
      if (vehicle.vin) lookup.vin.set(vehicle.vin, vehicle);
    }
  }
  return lookup;
}

function indexExistingVehicle(
  lookup: ExistingVehicleLookup,
  vehicle: ExistingVehicle,
  previous?: ExistingVehicle | null,
): void {
  const fields: Array<keyof ExistingVehicleLookup> = [
    'economicNumber',
    'expedientNumber',
    'plate',
    'vin',
  ];
  for (const field of fields) {
    const previousValue = previous?.[field];
    const nextValue = vehicle[field];
    if (
      previousValue
      && previousValue !== nextValue
      && lookup[field].get(previousValue)?.id === vehicle.id
    ) {
      lookup[field].delete(previousValue);
    }
    if (nextValue) lookup[field].set(nextValue, vehicle);
  }
}

async function importVehiclesFromMatrix(
  matrix: ImportMatrix,
  options: ImportOptions,
): Promise<ImportResult> {
  const headerRowIdx = detectHeaderRow(matrix);
  const headers = (matrix[headerRowIdx] || []).map((h) => String(h ?? '').trim());

  // Convertir las filas de datos a objetos usando los headers detectados
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Record<string, any>[] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: Record<string, any> = {};
    let hasAny = false;
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      const v = r[j];
      obj[h] = v;
      if (v != null && String(v).trim() !== '') hasAny = true;
    }
    if (hasAny) rows.push(obj);
  }

  const maxRows = options.maxRows ?? DEFAULT_MAX_IMPORT_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > DEFAULT_MAX_IMPORT_ROWS) {
    throw new ImportValidationError(
      `Límite de filas inválido (máximo ${DEFAULT_MAX_IMPORT_ROWS})`,
    );
  }
  if (rows.length > maxRows) {
    throw new ImportValidationError(
      `El archivo contiene ${rows.length} filas; el máximo permitido por importación es ${maxRows}`,
    );
  }

  const result: ImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [], warnings: [] };
  let unexpectedRowErrorsLogged = 0;

  // Offset para reportar nº de fila Excel real al usuario
  const excelRowOffset = headerRowIdx + 2; // +1 (1-indexed) +1 (saltar header)

  // Cache de tipos de vehículo por nombre (case-insensitive)
  const types = await prisma.vehicleType.findMany({ select: { id: true, name: true } });
  const typeByName = new Map<string, number>(types.map((t) => [t.name.toLowerCase(), t.id]));

  // Cache de operadores por fullName
  const operators = await prisma.operator.findMany({ select: { id: true, fullName: true } });
  const opByName = new Map<string, number>(operators.map((o) => [o.fullName.toLowerCase(), o.id]));

  // Usuario de sistema para las notas de bitácora de importación, resuelto UNA
  // sola vez (antes era un findFirst(ADMIN) por cada fila con observaciones: N+1).
  const sysUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const sysUserId = sysUser?.id ?? null;

  const existingLookup = await preloadExistingVehicles(rows);
  await options.onProgress?.(5);
  const defaultModelYear = businessPeriodForDate().year;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNumber = i + excelRowOffset; // nº fila Excel real

    const norm = normalizeImportRow(raw);

    try {
      const plate = parseString(norm.plate);
      const economicNumber = parseString(norm.economicNumber);
      const expedient = parseString(norm.expedientNumber);
      const vin = parseString(norm.vin);

      // La ausencia de estatus no significa "alta" para una unidad existente:
      // debe preservar su estado. El default true se aplica solo al crear.
      let requestedIsActive: boolean | undefined;
      if (norm._status != null && String(norm._status).trim() !== '') {
        const s = String(norm._status).toLowerCase();
        requestedIsActive = !s.includes('baja') && !s.includes('inactiv');
      }

      // ¿Hay un vehículo existente referenciado por ≥2 claves reales? Resolverlo
      // antes de cualquier escritura auxiliar permite rechazar una reactivación
      // sin crear, por ejemplo, un tipo de vehículo huérfano.
      const keyMatches = [
        economicNumber ? existingLookup.economicNumber.get(economicNumber) : null,
        expedient ? existingLookup.expedientNumber.get(expedient) : null,
        plate ? existingLookup.plate.get(plate) : null,
        vin ? existingLookup.vin.get(vin) : null,
      ].filter((vehicle): vehicle is ExistingVehicle => vehicle != null);
      const hitCount = new Map<number, number>();
      for (const match of keyMatches) {
        hitCount.set(match.id, (hitCount.get(match.id) ?? 0) + 1);
      }
      const existing = keyMatches.find(
        (match) => (hitCount.get(match.id) ?? 0) >= 2,
      ) ?? null;
      const unmatchedInactiveVehicle = existing == null
        ? keyMatches.find((match) => !match.isActive)
        : null;
      if (unmatchedInactiveVehicle) {
        throw new ImportValidationError(
          `La fila ${rowNumber} coincide con una unidad dada de baja, pero no aporta al menos dos identificadores coincidentes; no se puede crear ni reactivar por importación`,
        );
      }
      if (existing && !existing.isActive && requestedIsActive === true) {
        throw new ImportValidationError(
          `La fila ${rowNumber} intenta reactivar una unidad dada de baja; la reactivación requiere un flujo administrativo explícito`,
        );
      }

      // Resolver tipo de vehículo (crea si no existe)
      let vehicleTypeId: number | undefined;
      const typeName = parseString(norm.vehicleTypeName);
      if (typeName) {
        const existingTypeId = typeByName.get(typeName.toLowerCase());
        if (existingTypeId) {
          vehicleTypeId = existingTypeId;
        } else {
          const created = await prisma.vehicleType.create({
            data: { name: typeName, expectedKmPerLiter: 8.0 },
          });
          typeByName.set(typeName.toLowerCase(), created.id);
          vehicleTypeId = created.id;
        }
      }

      // Año del modelo (puede venir como fecha completa)
      const year = parseYear(norm.year) ?? defaultModelYear;

      // Clasificación inferida del USO (si no se dio explícita)
      const classification = classifyFromUsage(norm.usage as string | undefined) ?? 'ESTATAL';

      // Marcador uniforme para datos faltantes
      const MISSING = 'SIN DATO';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = {
        // Identificadores: si faltan, generamos uno único basado en la fila
        // (la unicidad la garantiza el sufijo de fila Excel)
        plate: plate || `SIN PLACA FILA-${rowNumber}`,
        economicNumber: economicNumber || `SIN ECO FILA-${rowNumber}`,
        ...(expedient ? { expedientNumber: expedient } : {}),
        previousPlate: parseString(norm.previousPlate),

        // Texto: SIN DATO si falta
        brand: parseString(norm.brand) ?? MISSING,
        model: parseString(norm.model) ?? MISSING,  // columna separada si existe; sino MISSING
        year,
        vin,
        color: parseString(norm.color) ?? MISSING,
        engineNumber: parseString(norm.engineNumber) ?? MISSING,
        cylinders: parseInt(norm.cylinders),  // null OK
        vehicleClass: parseString(norm.vehicleClass) ?? MISSING,
        usage: parseString(norm.usage) ?? MISSING,
        classification,
        executiveUnit: parseString(norm.executiveUnit) ?? MISSING,
        area: parseString(norm.area) ?? MISSING,
        physicalCondition: parseString(norm.physicalCondition) ?? MISSING,

        // Años: usa parseYear (tolera fechas completas y timestamps Excel)
        lastInsuredYear: parseYear(norm.lastInsuredYear),
        lastTenenciaYear: parseYear(norm.lastTenenciaYear),
        lastResguardoDate: parseDate(norm.lastResguardoDate),
        invoiceCertifiedAt: parseDate(norm.invoiceCertifiedAt),

        isActive: requestedIsActive ?? true,
        ...(vehicleTypeId ? { vehicleTypeId } : {}),
      };

      // Coincidencia IDEMPOTENTE pero SEGURA: se considera "el mismo vehículo" (→ UPDATE)
      // solo cuando AL MENOS DOS identificadores únicos REALES apuntan al mismo registro
      // existente. Con una sola coincidencia se trata como vehículo DISTINTO y se crea
      // (safeCreate desambigua la clave que choque, con su warning). Así un valor basura
      // repetido en el Excel —p. ej. un VIN '0' o un económico duplicado en dos renglones
      // de vehículos diferentes— ya NO fusiona dos registros. Los placeholders por posición
      // (`SIN ECO/PLACA FILA-N`) NO cuentan como clave. La lectura va FUERA de la tx (la
      // caché de tipos es compartida entre filas, no debe revertirse).
      if (existing) {
        // El estado de un registro existente se muta exclusivamente mediante
        // deactivateVehicleInTransaction. safeUpdate nunca puede reactivarlo.
        delete data.isActive;
        if (!vehicleTypeId) delete data.vehicleTypeId;
        // No pisar un identificador REAL existente con un placeholder por posición:
        // si la fila no traía económico/placa (se generó `SIN ECO/PLACA FILA-N`) y
        // el vehículo encontrado —p. ej. por placa/VIN— ya tiene uno real, se conserva.
        if (data.economicNumber?.startsWith('SIN ECO FILA-') && !existing.economicNumber.startsWith('SIN ECO FILA-')) {
          delete data.economicNumber;
        }
        if (data.plate?.startsWith('SIN PLACA FILA-') && !existing.plate.startsWith('SIN PLACA FILA-')) {
          delete data.plate;
        }
      } else if (!vehicleTypeId) {
        const fallback = typeByName.get('sin clasificar')
          || (await prisma.vehicleType.create({ data: { name: 'Sin clasificar', expectedKmPerLiter: 8.0 } })).id;
        typeByName.set('sin clasificar', fallback);
        data.vehicleTypeId = fallback;
      }

      const resguardanteName = parseString(norm._resguardanteName);
      const resguardanteOpId = resguardanteName ? opByName.get(resguardanteName.toLowerCase()) : undefined;
      const obs = parseString(norm._observations);
      let persistedVehicle: ExistingVehicle | null = null;

      // Todas las ESCRITURAS de la fila en UNA transacción: si algo falla a media
      // fila, no queda un vehículo sin su asignación/nota (estado parcial).
      await prisma.$transaction(async (tx) => {
        let expectedState = existing
          ? { isActive: existing.isActive, updatedAt: existing.updatedAt }
          : null;
        if (existing?.isActive && requestedIsActive === false) {
          const deactivation = await deactivateVehicleInTransaction(tx, existing.id, {
            actorUserId: options.actorUserId,
            source: 'VEHICLE_IMPORT',
          });
          expectedState = {
            isActive: false,
            updatedAt: deactivation.vehicle.updatedAt,
          };
        }
        const vehicle = existing
          ? await safeUpdate(
              tx,
              existing.id,
              data,
              rowNumber,
              result.warnings,
              expectedState!,
            )
          : await safeCreate(tx, data, rowNumber, result.warnings);
        persistedVehicle = {
          id: vehicle.id,
          economicNumber: vehicle.economicNumber,
          expedientNumber: vehicle.expedientNumber,
          plate: vehicle.plate,
          vin: vehicle.vin,
          isActive: vehicle.isActive,
          updatedAt: vehicle.updatedAt,
        };

        // Resguardante → crear/actualizar asignación
        if (resguardanteOpId && vehicle.isActive) {
          const active = await tx.vehicleAssignment.findFirst({
            where: { vehicleId: vehicle.id, endDate: null },
          });
          if (!active || active.operatorId !== resguardanteOpId) {
            if (active) await tx.vehicleAssignment.update({ where: { id: active.id }, data: { endDate: new Date() } });
            await tx.vehicleAssignment.create({
              data: { vehicleId: vehicle.id, operatorId: resguardanteOpId, type: 'FIXED' },
            });
          }
        }

        // Observaciones → nota de bitácora (solo en alta y si hay user de sistema)
        if (obs && existing == null && sysUserId != null) {
          await tx.vehicleNote.create({
            data: { vehicleId: vehicle.id, content: `[Importado] ${obs}`, createdBy: sysUserId },
          });
        }
      });

      if (persistedVehicle) indexExistingVehicle(existingLookup, persistedVehicle, existing);

      // Contadores SOLO tras el commit exitoso de la fila.
      if (existing) result.updated++;
      else result.created++;
    } catch (e) {
      if (!(e instanceof ImportValidationError)) {
        if (unexpectedRowErrorsLogged < 10) {
          logger.error(
            { err: e, row: rowNumber },
            'Error interno al importar fila de vehículo',
          );
        } else if (unexpectedRowErrorsLogged === 10) {
          logger.warn(
            { suppressedFromRow: rowNumber },
            'Se omiten detalles repetidos de errores internos de importación',
          );
        }
        unexpectedRowErrorsLogged += 1;
      }
      result.errors.push({
        row: rowNumber,
        message: publicImportErrorMessage(e, 'row'),
        data: norm,
      });
    }

    if (options.onProgress && ((i + 1) % 100 === 0 || i === rows.length - 1)) {
      await options.onProgress(5 + Math.floor(((i + 1) / Math.max(rows.length, 1)) * 90));
    }
  }

  return result;
}

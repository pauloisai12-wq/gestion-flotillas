// /api/src/services/vehicleImportService.ts
// Importa vehículos desde Excel/CSV — upsert por economicNumber o expedientNumber

import * as XLSX from 'xlsx';
import prisma, { type Tx } from '../lib/prisma';
import { VehicleClassification } from '@prisma/client';

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string; data?: Record<string, unknown> }[];
  // Avisos no fatales: p.ej. una clave única REAL (placa/económico/expediente)
  // que ya existía y se guardó desambiguada con sufijo -DUP- (revisar duplicado).
  warnings: { row: number; message: string }[];
}

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
  while (attempt < 6) {
    try {
      return await db.vehicle.create({ data });
    } catch (e) {
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
  throw new Error(`No se pudo crear tras múltiples intentos (fila ${rowNumber})`);
}

/**
 * Update con manejo de conflictos para campos unique (plate, vin, expedientNumber).
 * Si al actualizar genera duplicado con OTRO registro, nullifica/desambigua el campo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeUpdate(db: Tx, id: number, data: any, rowNumber: number, warnings: ImportResult['warnings']): Promise<any> {
  let attempt = 0;
  while (attempt < 6) {
    try {
      return await db.vehicle.update({ where: { id }, data });
    } catch (e) {
      attempt++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
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
  throw new Error(`No se pudo actualizar tras múltiples intentos (fila ${rowNumber})`);
}

export async function importVehiclesFromBuffer(buffer: Buffer): Promise<ImportResult> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  // Leer como matriz cruda para detectar la fila de encabezados
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, blankrows: false });
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

  const result: ImportResult = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [], warnings: [] };

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

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNumber = i + excelRowOffset; // nº fila Excel real

    // Re-llavear con normalización
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const norm: Record<string, any> = {};
    for (const k in raw) {
      const nk = normalizeKey(k);
      const mapped = FIELD_MAP[nk];
      if (mapped) norm[mapped] = raw[k];
    }

    try {
      const plate = parseString(norm.plate);
      const economicNumber = parseString(norm.economicNumber);
      const expedient = parseString(norm.expedientNumber);

      // No omitimos ninguna fila con datos — usamos placeholders para campos faltantes
      const hasAnyId = plate || economicNumber || expedient;

      // Resolver tipo de vehículo (crea si no existe)
      let vehicleTypeId: number | undefined;
      const typeName = parseString(norm.vehicleTypeName);
      if (typeName) {
        const existing = typeByName.get(typeName.toLowerCase());
        if (existing) {
          vehicleTypeId = existing;
        } else {
          const created = await prisma.vehicleType.create({
            data: { name: typeName, expectedKmPerLiter: 8.0 },
          });
          typeByName.set(typeName.toLowerCase(), created.id);
          vehicleTypeId = created.id;
        }
      }

      // Estatus alta/baja → isActive
      let isActive = true;
      if (norm._status != null) {
        const s = String(norm._status).toLowerCase();
        isActive = !s.includes('baja') && !s.includes('inactiv');
      }

      // Año del modelo (puede venir como fecha completa)
      const year = parseYear(norm.year) ?? new Date().getFullYear();

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
        vin: parseString(norm.vin),
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

        isActive,
        ...(vehicleTypeId ? { vehicleTypeId } : {}),
      };

      // Upsert por economicNumber primero (más confiable que la placa, que cambia).
      // La LECTURA y la resolución del tipo de respaldo van FUERA de la tx
      // (la caché de tipos es compartida entre filas, no debe revertirse).
      const existing = economicNumber
        ? await prisma.vehicle.findUnique({ where: { economicNumber } })
        : null;

      if (existing) {
        if (!vehicleTypeId) delete data.vehicleTypeId;
      } else if (!vehicleTypeId) {
        const fallback = typeByName.get('sin clasificar')
          || (await prisma.vehicleType.create({ data: { name: 'Sin clasificar', expectedKmPerLiter: 8.0 } })).id;
        typeByName.set('sin clasificar', fallback);
        data.vehicleTypeId = fallback;
      }

      const resguardanteName = parseString(norm._resguardanteName);
      const resguardanteOpId = resguardanteName ? opByName.get(resguardanteName.toLowerCase()) : undefined;
      const obs = parseString(norm._observations);

      // Todas las ESCRITURAS de la fila en UNA transacción: si algo falla a media
      // fila, no queda un vehículo sin su asignación/nota (estado parcial).
      await prisma.$transaction(async (tx) => {
        const vehicle = existing
          ? await safeUpdate(tx, existing.id, data, rowNumber, result.warnings)
          : await safeCreate(tx, data, rowNumber, result.warnings);

        // Resguardante → crear/actualizar asignación
        if (resguardanteOpId) {
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

      // Contadores SOLO tras el commit exitoso de la fila.
      if (existing) result.updated++;
      else result.created++;
    } catch (e) {
      result.errors.push({
        row: rowNumber,
        message: (e as Error).message,
        data: norm,
      });
    }
  }

  return result;
}

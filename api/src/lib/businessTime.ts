export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

export interface BusinessPeriod {
  year: number;
  month: number;
}

export interface BusinessDateRange {
  from?: Date;
  toExclusive?: Date;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const periodFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;
  if (value == null) throw new RangeError(`No se pudo obtener ${type} en ${BUSINESS_TIME_ZONE}`);
  return Number(value);
}

function assertValidDate(date: Date) {
  if (Number.isNaN(date.getTime())) throw new RangeError('Fecha inválida');
}

function utcWallClock(parts: CivilDate): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

function parseCivilDate(value: string): CivilDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Fecha civil inválida');

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const normalized = utcWallClock(parts);
  if (
    normalized.getUTCFullYear() !== parts.year
    || normalized.getUTCMonth() + 1 !== parts.month
    || normalized.getUTCDate() !== parts.day
  ) {
    throw new RangeError('Fecha civil inválida');
  }
  return parts;
}

/** Mes/año civil en la zona oficial de operación, independiente del host. */
export function businessPeriodForDate(date: Date = new Date()): BusinessPeriod {
  assertValidDate(date);
  const parts = periodFormatter.formatToParts(date);
  return {
    year: numericPart(parts, 'year'),
    month: numericPart(parts, 'month'),
  };
}

function offsetAt(date: Date) {
  const parts = dateTimeFormatter.formatToParts(date);
  const localAsUtc = Date.UTC(
    numericPart(parts, 'year'),
    numericPart(parts, 'month') - 1,
    numericPart(parts, 'day'),
    numericPart(parts, 'hour'),
    numericPart(parts, 'minute'),
    numericPart(parts, 'second'),
  );
  const instantWithoutMilliseconds = Math.trunc(date.getTime() / 1000) * 1000;
  return localAsUtc - instantWithoutMilliseconds;
}

function businessWallClockStart(parts: CivilDate): Date {
  const wallClockAsUtc = utcWallClock(parts).getTime();
  let instant = wallClockAsUtc;
  // Dos iteraciones resuelven el offset aun si la primera aproximación cae
  // del otro lado de una transición histórica de horario de verano.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    instant = wallClockAsUtc - offsetAt(new Date(instant));
  }
  return new Date(instant);
}

/** Instante UTC que corresponde al primer día del periodo a las 00:00 CDMX. */
export function businessPeriodStart(period: BusinessPeriod): Date {
  if (!Number.isInteger(period.year) || !Number.isInteger(period.month)
      || period.month < 1 || period.month > 12) {
    throw new RangeError('Periodo de negocio inválido');
  }

  return businessWallClockStart({ year: period.year, month: period.month, day: 1 });
}

/** Instante UTC correspondiente a las 00:00 de una fecha civil de CDMX. */
export function businessDateStart(value: string): Date {
  return businessWallClockStart(parseCivilDate(value));
}

/**
 * Convierte filtros inclusivos YYYY-MM-DD al intervalo [inicio, día siguiente).
 * El límite superior exclusivo evita perder registros del último día.
 */
export function businessDateRange(dateFrom?: string, dateTo?: string): BusinessDateRange {
  const from = dateFrom ? businessDateStart(dateFrom) : undefined;
  let toExclusive: Date | undefined;

  if (dateTo) {
    const to = parseCivilDate(dateTo);
    const nextDay = utcWallClock(to);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    toExclusive = businessWallClockStart({
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
    });
  }

  if (from && toExclusive && from >= toExclusive) {
    throw new RangeError('El inicio del rango debe ser anterior o igual al fin');
  }
  return { from, toExclusive };
}

/** Fecha civil DD/MM/AAAA en la zona oficial, independiente del host. */
export function formatBusinessDate(value: Date): string {
  assertValidDate(value);
  const parts = dateTimeFormatter.formatToParts(value);
  const day = String(numericPart(parts, 'day')).padStart(2, '0');
  const month = String(numericPart(parts, 'month')).padStart(2, '0');
  const year = numericPart(parts, 'year');
  return `${day}/${month}/${year}`;
}

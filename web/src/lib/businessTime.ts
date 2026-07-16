export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

export interface BusinessPeriod {
  year: number;
  month: number;
}

const periodFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

function numericPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value == null) throw new RangeError(`No se pudo obtener ${type} en ${BUSINESS_TIME_ZONE}`);
  return Number(value);
}

/** Mes/año civil oficial, independiente de la zona configurada en el dispositivo. */
export function businessPeriodForDate(date: Date = new Date()): BusinessPeriod {
  if (Number.isNaN(date.getTime())) throw new RangeError('Fecha inválida');
  const parts = periodFormatter.formatToParts(date);
  return {
    year: numericPart(parts, 'year'),
    month: numericPart(parts, 'month'),
  };
}

export function previousBusinessPeriod(date: Date = new Date()): BusinessPeriod {
  const current = businessPeriodForDate(date);
  return current.month === 1
    ? { year: current.year - 1, month: 12 }
    : { year: current.year, month: current.month - 1 };
}

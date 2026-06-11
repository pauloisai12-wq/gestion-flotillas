// Formateo centralizado de números, moneda y fechas (locale es-MX).
// Única fuente de verdad del locale: evita mezclar toLocaleString() con y sin
// 'es-MX' por archivo. Todos devuelven '—' ante valores nulos o inválidos.

const LOCALE = 'es-MX';

export function formatNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString(LOCALE, options);
}

export function formatCurrency(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  const formatted = formatNumber(value, options);
  return formatted === '—' ? formatted : `$${formatted}`;
}

export function formatDate(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, options);
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(LOCALE, options);
}

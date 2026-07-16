import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_TIME_ZONE,
  businessDateRange,
  businessDateStart,
  businessPeriodForDate,
  businessPeriodStart,
  formatBusinessDate,
} from '../../src/lib/businessTime';

describe('periodo de negocio en Ciudad de México', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mantiene julio cuando Hetzner UTC ya está en agosto', () => {
    const instant = new Date('2026-08-01T03:00:00.000Z');

    expect(businessPeriodForDate(instant)).toEqual({ year: 2026, month: 7 });
  });

  it('cambia a agosto exactamente a medianoche de Ciudad de México', () => {
    expect(businessPeriodForDate(new Date('2026-08-01T05:59:59.999Z')))
      .toEqual({ year: 2026, month: 7 });
    expect(businessPeriodForDate(new Date('2026-08-01T06:00:00.000Z')))
      .toEqual({ year: 2026, month: 8 });
  });

  it('usa la zona de negocio también cuando no se inyecta la fecha', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T03:00:00.000Z'));

    expect(BUSINESS_TIME_ZONE).toBe('America/Mexico_City');
    expect(businessPeriodForDate()).toEqual({ year: 2026, month: 12 });
  });

  it('convierte el inicio civil del periodo al instante UTC correcto', () => {
    const start = businessPeriodStart({ year: 2026, month: 8 });

    expect(start.toISOString()).toBe('2026-08-01T06:00:00.000Z');
    expect(businessPeriodForDate(start)).toEqual({ year: 2026, month: 8 });
  });

  it('convierte un rango civil inclusivo a límites UTC con fin exclusivo', () => {
    const range = businessDateRange('2026-07-31', '2026-07-31');

    expect(range.from?.toISOString()).toBe('2026-07-31T06:00:00.000Z');
    expect(range.toExclusive?.toISOString()).toBe('2026-08-01T06:00:00.000Z');
  });

  it('avanza correctamente el límite exclusivo entre años', () => {
    const range = businessDateRange(undefined, '2026-12-31');

    expect(range.toExclusive?.toISOString()).toBe('2027-01-01T06:00:00.000Z');
  });

  it('rechaza fechas civiles imposibles y rangos invertidos', () => {
    expect(() => businessDateStart('2026-02-30')).toThrow(RangeError);
    expect(() => businessDateRange('2026-08-02', '2026-08-01')).toThrow(RangeError);
  });

  it('formatea fechas de folio en CDMX aunque el host opere en UTC', () => {
    expect(formatBusinessDate(new Date('2027-01-01T03:00:00.000Z')))
      .toBe('31/12/2026');
  });
});

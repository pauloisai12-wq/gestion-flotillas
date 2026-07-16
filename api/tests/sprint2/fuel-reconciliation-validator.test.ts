import { describe, expect, it } from 'vitest';
import { legacyFuelLoadReconciliationSchema } from '../../src/validators/fuelLoadValidator';

const base = {
  decision: 'REJECT' as const,
  reason: 'Comprobante historico contrastado',
  budgetEffect: 'NOT_APPLIED' as const,
  odometerEffect: 'APPLIED' as const,
};

describe('contrato de reconciliacion historica de combustible', () => {
  it('exige el odometro corregido cuando se rechaza un efecto ya aplicado', () => {
    const result = legacyFuelLoadReconciliationSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'correctedOdometer')).toBe(true);
    }
  });

  it('acepta una correccion no negativa para el rechazo', () => {
    expect(
      legacyFuelLoadReconciliationSchema.safeParse({ ...base, correctedOdometer: 98_450.5 }).success,
    ).toBe(true);
  });

  it('rechaza una correccion ambigua cuando no corresponde aplicarla', () => {
    expect(
      legacyFuelLoadReconciliationSchema.safeParse({
        ...base,
        odometerEffect: 'NOT_APPLIED',
        correctedOdometer: 98_450.5,
      }).success,
    ).toBe(false);
  });
});

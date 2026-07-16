import { describe, expect, it, vi } from 'vitest';
import { releaseFuelBudget } from '../../src/services/budgetService';

type LockedBudget = {
  id: number;
  baseAmount: string;
  rolloverIn: string;
  spentAmount: string;
  isClosed: boolean;
};

function transactionWithBudgets(budgets: LockedBudget[], vehicleIsActive = true) {
  const queue = [...budgets];
  const update = vi.fn().mockResolvedValue({});
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('FROM vehicle_budgets')) {
        const budget = queue.shift();
        return budget ? [budget] : [];
      }
      if (sql.includes('FROM vehicles')) return [{ isActive: vehicleIsActive }];
      return [{ advisory: null }];
    }),
    vehicleBudget: { update },
  };
  return { tx, update };
}

describe('compensación histórica de rollover', () => {
  it('no inventa carry cuando la liberación sigue absorbida por déficit', async () => {
    const { tx, update } = transactionWithBudgets([{
      id: 1,
      baseAmount: '100.00',
      rolloverIn: '0.00',
      spentAmount: '150.00',
      isClosed: true,
    }]);

    const result = await releaseFuelBudget(
      tx as unknown as Parameters<typeof releaseFuelBudget>[0],
      7,
      30,
      { year: 2026, month: 5 },
    );

    expect(result.availableAfterRelease).toBe(-20);
    expect(result.rolloverAdjustedBudgetIds).toEqual([]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.isCutOff).toBe(true);
  });

  it('propaga solo el remanente incremental a través de un mes deficitario', async () => {
    const { tx, update } = transactionWithBudgets([
      { id: 1, baseAmount: '100.00', rolloverIn: '0.00', spentAmount: '100.00', isClosed: true },
      { id: 2, baseAmount: '100.00', rolloverIn: '0.00', spentAmount: '110.00', isClosed: true },
      { id: 3, baseAmount: '100.00', rolloverIn: '0.00', spentAmount: '0.00', isClosed: false },
    ]);

    const result = await releaseFuelBudget(
      tx as unknown as Parameters<typeof releaseFuelBudget>[0],
      7,
      20,
      { year: 2026, month: 5 },
    );

    expect(result.rolloverAdjustedBudgetIds).toEqual([2, 3]);
    const increments = update.mock.calls.slice(1).map((call) =>
      Number(call[0].data.rolloverIn.increment),
    );
    expect(increments).toEqual([20, 10]);
  });

  it('devuelve al pote una liberación posterior a la baja sin reabrir saldo', async () => {
    const { tx, update } = transactionWithBudgets([{
      id: 4,
      baseAmount: '100.00',
      rolloverIn: '20.00',
      spentAmount: '120.00',
      isClosed: false,
    }], false);

    const result = await releaseFuelBudget(
      tx as unknown as Parameters<typeof releaseFuelBudget>[0],
      7,
      20,
      { year: 2026, month: 7 },
    );

    expect(result).toEqual({
      budgetId: 4,
      availableAfterRelease: 0,
      rolloverAdjustedBudgetIds: [],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        spentAmount: expect.objectContaining({}),
        baseAmount: expect.objectContaining({}),
        rolloverIn: expect.objectContaining({}),
        isCutOff: true,
      },
    });
    const normalized = update.mock.calls[0][0].data;
    expect(Number(normalized.spentAmount)).toBe(100);
    expect(Number(normalized.baseAmount)).toBe(100);
    expect(Number(normalized.rolloverIn)).toBe(0);
  });
});

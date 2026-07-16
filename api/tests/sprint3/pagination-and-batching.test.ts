import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  distributeBudgetSchema,
  listBudgetsQuerySchema,
  MAX_BUDGET_DISTRIBUTIONS,
} from '../../src/validators/budgetValidator';
import { maintenanceHistoryQuerySchema } from '../../src/validators/maintenanceValidator';
import { buildBudgetAllocations } from '../../src/services/budgetDistributionService';

describe('Sprint 3: contratos acotados y paginados', () => {
  it('normaliza la página de presupuestos y limita cada respuesta a 100 filas', () => {
    expect(listBudgetsQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 });
    expect(listBudgetsQuerySchema.parse({ page: '3', limit: '100', search: '  A-12  ' }))
      .toMatchObject({ page: 3, limit: 100, search: 'A-12' });
    expect(listBudgetsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('pagina el historial de mantenimiento con un máximo de 100 filas', () => {
    expect(maintenanceHistoryQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(maintenanceHistoryQuerySchema.safeParse({ page: '1', limit: '101' }).success)
      .toBe(false);
  });

  it('rechaza arreglos explícitos que exceden el máximo operativo', () => {
    const distributions = Array.from(
      { length: MAX_BUDGET_DISTRIBUTIONS + 1 },
      (_, index) => ({ vehicleId: index + 1, baseAmount: 1 }),
    );
    expect(distributeBudgetSchema.safeParse({
      kind: 'FUEL', year: 2026, month: 7, distributions,
    }).success).toBe(false);
  });

  it('distribuye 5,000 unidades en centavos exactos sin truncar el universo', () => {
    const ids = Array.from({ length: MAX_BUDGET_DISTRIBUTIONS }, (_, index) => index + 1);
    const startedAt = performance.now();
    const allocations = buildBudgetAllocations(ids, 'TOTAL', 10_000);
    const elapsedMs = performance.now() - startedAt;

    expect(allocations).toHaveLength(MAX_BUDGET_DISTRIBUTIONS);
    expect(Math.round(allocations.reduce((sum, row) => sum + row.baseAmount, 0) * 100))
      .toBe(1_000_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('usa count/skip/take y UPSERT set-based en vez de loops de Prisma', () => {
    const budgetRouter = readFileSync(resolve('src/routes/budgetRouter.ts'), 'utf8');
    const distributionService = readFileSync(
      resolve('src/services/budgetDistributionService.ts'),
      'utf8',
    );
    const maintenanceService = readFileSync(
      resolve('src/services/maintenanceRecordService.ts'),
      'utf8',
    );

    expect(budgetRouter).toContain('prisma.vehicleBudget.count({ where })');
    expect(budgetRouter).toContain('skip: (page - 1) * limit');
    expect(budgetRouter).toContain('take: limit');
    expect(distributionService).toContain('INSERT INTO vehicle_budgets');
    expect(distributionService).toContain('ON CONFLICT ("vehicleId", kind, year, month)');
    expect(maintenanceService).toContain('return getAll({ ...query, vehicleId });');
  });
});

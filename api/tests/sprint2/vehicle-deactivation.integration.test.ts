import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'deactivate' as 'deactivate' | 'rollover',
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  vehicleUpdate: vi.fn(),
  assignmentUpdateMany: vi.fn(),
  ticketFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  fuelCount: vi.fn(),
  fuelFindFirst: vi.fn(),
  budgetUpsert: vi.fn(),
  budgetUpdateMany: vi.fn(),
  monthlyBudgetUpsert: vi.fn(),
  vehicleCount: vi.fn(),
  documentCount: vi.fn(),
  fuelAggregate: vi.fn(),
  userFindUnique: vi.fn(),
  maintenanceTicketFindUnique: vi.fn(),
  maintenanceTicketUpdate: vi.fn(),
  vehicleFindUnique: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  vehicle: { update: mocks.vehicleUpdate },
  vehicleAssignment: { updateMany: mocks.assignmentUpdateMany },
  maintenanceTicket: { findFirst: mocks.ticketFindFirst },
  auditLog: { create: mocks.auditCreate },
  fuelLoad: { count: mocks.fuelCount, findFirst: mocks.fuelFindFirst },
  vehicleBudget: {
    upsert: mocks.budgetUpsert,
    updateMany: mocks.budgetUpdateMany,
  },
  monthlyBudget: { upsert: mocks.monthlyBudgetUpsert },
};

vi.mock('../../src/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    vehicle: { count: mocks.vehicleCount, findUnique: mocks.vehicleFindUnique },
    document: { count: mocks.documentCount },
    fuelLoad: { aggregate: mocks.fuelAggregate },
    user: { findUnique: mocks.userFindUnique },
    maintenanceTicket: {
      findUnique: mocks.maintenanceTicketFindUnique,
      update: mocks.maintenanceTicketUpdate,
    },
  },
}));

import { closeMonthAndRollover } from '../../src/services/budgetService';
import { getDashboardSummary } from '../../src/services/dashboardService';
import { deleteVehicle } from '../../src/services/vehicleService';
import { startRepair } from '../../src/services/tickets/approveFlow';

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

describe('baja lógica y presupuesto operativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode = 'deactivate';
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = sqlText(strings);
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: null }];
      if (mocks.mode === 'deactivate' && sql.includes('FROM vehicles')) {
        return [{ id: 7, isActive: true, executorId: 31 }];
      }
      if (mocks.mode === 'deactivate' && sql.includes('FROM vehicle_budgets')) {
        return [
          {
            id: 11,
            kind: 'FUEL',
            year: 2026,
            month: 7,
            baseAmount: '100.00',
            rolloverIn: '20.00',
            spentAmount: '40.00',
          },
          {
            id: 12,
            kind: 'MAINTENANCE',
            year: 2026,
            month: 8,
            baseAmount: '100.00',
            rolloverIn: '50.00',
            spentAmount: '120.00',
          },
        ];
      }
      if (sql.includes('SELECT 1 AS closed')) return [];
      if (sql.includes('SELECT open_period.year')) return [];
      if (mocks.mode === 'rollover' && sql.includes('FROM vehicle_budgets vb')) {
        return [
          {
            id: 21,
            vehicleId: 1,
            isActive: true,
            baseAmount: '100.00',
            rolloverIn: '0.00',
            spentAmount: '70.00',
          },
          {
            id: 22,
            vehicleId: 2,
            isActive: false,
            baseAmount: '100.00',
            rolloverIn: '0.00',
            spentAmount: '20.00',
          },
        ];
      }
      return [];
    });
    mocks.executeRaw.mockResolvedValue(1);
    mocks.assignmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.ticketFindFirst.mockResolvedValue(null);
    mocks.vehicleUpdate.mockResolvedValue({ id: 7, isActive: false, executorId: null });
    mocks.auditCreate.mockResolvedValue({ id: 1 });
    mocks.fuelCount.mockResolvedValue(0);
    mocks.fuelFindFirst.mockResolvedValue(null);
    mocks.budgetUpsert.mockResolvedValue({});
    mocks.budgetUpdateMany.mockResolvedValue({ count: 2 });
    mocks.monthlyBudgetUpsert.mockResolvedValue({});
    mocks.vehicleCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    mocks.documentCount.mockResolvedValue(0);
    mocks.fuelAggregate.mockResolvedValue({
      _count: 0,
      _sum: { amount: null, liters: null },
      _avg: { kmPerLiter: null },
    });
    mocks.userFindUnique.mockResolvedValue({ id: 5, role: 'WORKSHOP', workshopId: 9 });
    mocks.maintenanceTicketFindUnique.mockResolvedValue({
      id: 44,
      vehicleId: 7,
      requestedById: 31,
      status: 'APPROVED_FOR_REPAIR',
      selectedQuote: { workshopId: 9 },
    });
    mocks.vehicleFindUnique.mockResolvedValue({ isActive: true });
  });

  it('libera solo saldos abiertos y cierra la operación completa en una transacción', async () => {
    await expect(deleteVehicle(7, 99)).resolves.toMatchObject({
      id: 7,
      isActive: false,
    });

    const timelineValues = mocks.queryRaw.mock.calls
      .filter(([strings]) => sqlText(strings).includes('budget-timeline:') === false
        && sqlText(strings).includes('pg_advisory_xact_lock'))
      .flatMap((call) => call.slice(1));
    // Los valores parametrizados muestran el orden estable entre timelines.
    expect(timelineValues).toEqual(['budget-timeline:FUEL', 'budget-timeline:MAINTENANCE']);
    expect(mocks.ticketFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vehicleId: 7,
        status: {
          in: [
            'PENDING_ADMIN_APPROVAL',
            'AWAITING_QUOTES',
            'APPROVED_FOR_REPAIR',
            'IN_REPAIR',
          ],
        },
      },
    }));

    const releaseSql = sqlText(mocks.executeRaw.mock.calls[0][0]);
    expect(releaseSql).toContain('SET "baseAmount" = LEAST("baseAmount", "spentAmount")');
    expect(releaseSql).toContain('GREATEST("spentAmount" - "baseAmount", 0)');
    expect(releaseSql).toContain('AND "isClosed" = false');
    expect(mocks.assignmentUpdateMany).toHaveBeenCalledWith({
      where: { vehicleId: 7, endDate: null },
      data: { endDate: expect.any(Date) },
    });
    expect(mocks.vehicleUpdate).toHaveBeenCalledWith({
      where: { id: 7, isActive: true },
      data: { isActive: false, executorId: null },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 99,
        action: 'DEACTIVATE',
        metadata: expect.objectContaining({
          releasedBase: '60.00',
          releasedRollover: '50.00',
          affectedOpenBudgets: 2,
        }),
      }),
    }));
    const auditAfter = mocks.auditCreate.mock.calls[0][0].data.after;
    expect(Number(auditAfter.openBudgets[0].baseAmount)
      + Number(auditAfter.openBudgets[0].rolloverIn)).toBe(40);
    expect(auditAfter.openBudgets[1]).toMatchObject({
      id: 12,
      baseAmount: '100.00',
      rolloverIn: '20.00',
      spentAmount: '120.00',
    });
    expect(Number(auditAfter.openBudgets[1].baseAmount)
      + Number(auditAfter.openBudgets[1].rolloverIn)).toBe(120);
  });

  it.each([
    'PENDING_ADMIN_APPROVAL',
    'AWAITING_QUOTES',
    'APPROVED_FOR_REPAIR',
    'IN_REPAIR',
  ])('rechaza la baja mientras exista un ticket no terminal: %s', async (status) => {
    mocks.ticketFindFirst.mockResolvedValue({ id: 44, folio: 'SM-2026-00044', status });

    await expect(deleteVehicle(7, 99)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.assignmentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.vehicleUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('impide iniciar una reparación legacy si la unidad ya está inactiva', async () => {
    mocks.vehicleFindUnique.mockResolvedValue({ isActive: false });

    await expect(startRepair(44, 5)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: 'El vehículo está dado de baja',
    });
    expect(mocks.maintenanceTicketUpdate).not.toHaveBeenCalled();
  });

  it('cierra la historia inactiva pero solo genera rollover para unidades activas', async () => {
    mocks.mode = 'rollover';

    const result = await closeMonthAndRollover({
      kind: 'FUEL',
      year: 2025,
      month: 6,
    });

    expect(mocks.budgetUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.budgetUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vehicleId_kind_year_month: {
          vehicleId: 1,
          kind: 'FUEL',
          year: 2025,
          month: 7,
        },
      },
    }));
    expect(mocks.budgetUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [21, 22] } },
      data: { isClosed: true, closedAt: expect.any(Date) },
    });
    expect(result.results[0]).toMatchObject({
      closed: 2,
      rolledOver: 1,
      remainderTotal: 30,
    });
  });

  it('excluye bajas de documentos y vistas operativas sin borrar hechos históricos', async () => {
    await getDashboardSummary({ vehicleTypeId: 4 });

    for (const [query] of mocks.documentCount.mock.calls) {
      expect(query.where.vehicle).toMatchObject({ isActive: true, vehicleTypeId: 4 });
    }
    for (const [query] of mocks.fuelAggregate.mock.calls) {
      expect(query.where.vehicle).toMatchObject({ vehicleTypeId: 4 });
      expect(query.where.vehicle).not.toHaveProperty('isActive');
    }

    const migration = fs.readFileSync(
      path.resolve('prisma/migrations/20260716000000_vehicle_deactivation_policy/migration.sql'),
      'utf8',
    );
    expect(migration).toContain('AND vb."isClosed" = false');
    expect(migration).toContain('WHERE v."isActive" = true');
    expect(migration).not.toContain('DROP MATERIALIZED VIEW IF EXISTS mv_fuel_monthly_trend');
    const dashboardSummary = migration.slice(
      migration.indexOf('CREATE MATERIALIZED VIEW mv_dashboard_summary AS'),
      migration.indexOf('CREATE MATERIALIZED VIEW mv_vehicle_ranking AS'),
    );
    expect(dashboardSummary).not.toContain(
      'JOIN vehicles fv ON fv.id = fl."vehicleId" AND fv."isActive" = true',
    );
    expect(migration).toContain('JOIN vehicles v ON v.id = fl."vehicleId" AND v."isActive" = true');
    expect(migration).toContain('vehículos inactivos con tickets no terminales');
    expect(migration).not.toMatch(/UPDATE vehicle_budgets[\s\S]*?"isClosed" = true/);

    const dashboardSource = fs.readFileSync(
      path.resolve('src/services/dashboardService.ts'),
      'utf8',
    );
    expect(dashboardSource).toContain('Prisma.sql`v."isActive" = true`');

    const distributionSource = fs.readFileSync(
      path.resolve('src/services/budgetDistributionService.ts'),
      'utf8',
    );
    expect(distributionSource).toContain('Excluirlas aquí liberaría dos');
    expect(distributionSource).not.toContain(
      'NOT: { vehicleId: { in: targetIds } },\n      vehicle: { isActive: true }',
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'OTHER_EXECUTOR',
  events: [] as string[],
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  ticketCreate: vi.fn(),
  userFindMany: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  maintenanceTicket: { create: mocks.ticketCreate },
};

vi.mock('../../src/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    user: { findMany: mocks.userFindMany },
  },
}));

import { createTicket } from '../../src/services/tickets/createFlow';

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

const input = {
  vehicleId: 7,
  failureCategory: 'BRAKES' as const,
  description: 'Los frenos pierden presión al circular',
  reportedOdometer: 42_000,
  odometerStatus: 'OK' as const,
};

describe('alta de ticket contra baja lógica', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.mode = 'ACTIVE';
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.userFindMany.mockResolvedValue([]);
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = sqlText(strings);
      if (sql.includes('FROM vehicles')) {
        mocks.events.push('vehicle-lock');
        return [{
          id: 7,
          executorId: mocks.mode === 'OTHER_EXECUTOR' ? 99 : 31,
          isActive: mocks.mode !== 'INACTIVE',
          economicNumber: 'E-7',
          plate: 'P-7',
        }];
      }
      if (sql.includes('maintenance_folio_counters')) {
        mocks.events.push('folio');
        return [{ lastValue: 12 }];
      }
      return [];
    });
    mocks.ticketCreate.mockImplementation(async ({ data }) => {
      mocks.events.push('ticket-create');
      return { id: 44, ...data };
    });
  });

  it('bloquea y valida el vehículo antes de consumir folio e insertar', async () => {
    const ticket = await createTicket(31, input);

    expect(ticket).toMatchObject({
      id: 44,
      folio: expect.stringMatching(/^SM-\d{4}-00012$/),
      vehicleId: 7,
      requestedById: 31,
    });
    expect(mocks.events).toEqual(['vehicle-lock', 'folio', 'ticket-create']);
    const vehicleLockSql = sqlText(mocks.queryRaw.mock.calls[0][0]);
    expect(vehicleLockSql).toContain('FROM vehicles');
    expect(vehicleLockSql).toContain('FOR KEY SHARE');
  });

  it('si la baja ganó el lock, observa inactivo y no crea ticket ni consume folio', async () => {
    mocks.mode = 'INACTIVE';

    await expect(createTicket(31, input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Vehículo inactivo',
    });
    expect(mocks.events).toEqual(['vehicle-lock']);
    expect(mocks.ticketCreate).not.toHaveBeenCalled();
  });

  it('valida la asignación del ejecutor bajo el mismo lock', async () => {
    mocks.mode = 'OTHER_EXECUTOR';

    await expect(createTicket(31, input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.events).toEqual(['vehicle-lock']);
    expect(mocks.ticketCreate).not.toHaveBeenCalled();
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn(),
  reportCreate: vi.fn(),
  outboxCreate: vi.fn(),
  outboxFindMany: vi.fn(),
  outboxUpdateMany: vi.fn(),
  txQuery: vi.fn(),
  reportUpdateMany: vi.fn(),
  outboxUpsert: vi.fn(),
}));

vi.mock('../../src/config/queue', () => ({
  createQueue: () => ({ add: mocks.add, close: mocks.close }),
}));

vi.mock('../../src/lib/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    reportGenerationOutbox: {
      findMany: mocks.outboxFindMany,
      updateMany: mocks.outboxUpdateMany,
    },
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import {
  recoverExpiredReportGenerations,
  requestReportGeneration,
} from '../../src/services/reportService';

describe('ciclo idempotente de reportes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      reportHistory: { create: mocks.reportCreate },
      reportGenerationOutbox: { create: mocks.outboxCreate },
    }));
    mocks.outboxCreate.mockResolvedValue({ id: 1 });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('confirma historial + outbox antes de publicar un job determinista', async () => {
    const order: string[] = [];
    mocks.reportCreate.mockImplementation(async () => {
      order.push('history');
      return { id: 41 };
    });
    mocks.outboxCreate.mockImplementation(async () => {
      order.push('outbox');
      return { id: 91 };
    });
    mocks.outboxFindMany.mockResolvedValue([{
      id: 91,
      reportHistoryId: 41,
      publishedAt: null,
      attempts: 0,
      reportHistory: {
        id: 41,
        month: 7,
        year: 2026,
        requestedBy: 'admin@example.com',
        status: 'PROCESSING',
      },
    }]);
    mocks.add.mockImplementation(async () => {
      order.push('queue');
      return { id: 'report-history-41' };
    });

    const result = await requestReportGeneration(7, 2026, 'admin@example.com');

    expect(order).toEqual(['history', 'outbox', 'queue']);
    expect(mocks.reportCreate).toHaveBeenCalledWith({
      data: { month: 7, year: 2026, requestedBy: 'admin@example.com', status: 'PROCESSING' },
      select: { id: true },
    });
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: { reportHistoryId: 41 },
    });
    expect(mocks.add).toHaveBeenCalledWith(
      'generate-monthly-report',
      {
        reportHistoryId: 41,
        month: 7,
        year: 2026,
        requestedBy: 'admin@example.com',
      },
      {
        jobId: 'report-history-41',
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );
    expect(result).toMatchObject({
      reportHistoryId: 41,
      jobId: 'report-history-41',
      queued: true,
    });
  });

  it('conserva el outbox pendiente si Redis no está disponible', async () => {
    mocks.reportCreate.mockResolvedValue({ id: 42 });
    mocks.outboxFindMany.mockResolvedValue([{
      id: 92,
      attempts: 0,
      reportHistory: {
        id: 42,
        month: 7,
        year: 2026,
        requestedBy: 'admin@example.com',
        status: 'PROCESSING',
      },
    }]);
    mocks.add.mockRejectedValue(new Error('redis unavailable'));

    const result = await requestReportGeneration(7, 2026, 'admin@example.com');

    expect(result).toMatchObject({ reportHistoryId: 42, queued: false });
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith({
      where: { id: 92, publishedAt: null },
      data: {
        attempts: { increment: 1 },
        lastError: 'redis unavailable',
      },
    });
  });

  it('traduce la carrera del índice único en conflicto 409', async () => {
    mocks.reportCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate processing period', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['month', 'year'] },
      }),
    );

    await expect(
      requestReportGeneration(7, 2026, 'admin@example.com'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('reabre el outbox cuando vence la concesión del worker', async () => {
    mocks.txQuery.mockResolvedValue([{ id: 77 }]);
    mocks.reportUpdateMany.mockResolvedValue({ count: 1 });
    mocks.outboxUpsert.mockResolvedValue({ id: 9 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.txQuery,
      reportHistory: { updateMany: mocks.reportUpdateMany },
      reportGenerationOutbox: { upsert: mocks.outboxUpsert },
    }));

    await expect(recoverExpiredReportGenerations()).resolves.toBe(1);
    const recoverySql = mocks.txQuery.mock.calls[0][0].join(' ');
    expect(recoverySql).toContain('rh."runToken" IS NULL');
    expect(recoverySql).toContain('outbox."publishedAt" IS NOT NULL');
    expect(mocks.reportUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 77, status: 'PROCESSING' }),
      data: expect.objectContaining({ runToken: null, leaseExpiresAt: null }),
    }));
    expect(mocks.outboxUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { reportHistoryId: 77 },
      update: expect.objectContaining({ publishedAt: null }),
    }));
  });

  it('la migración instala unicidad, lease CAS y outbox durable', () => {
    const migration = fs.readFileSync(
      path.resolve(
        'prisma/migrations/20260715030000_report_generation_integrity/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX report_history_one_processing_period_idx');
    expect(migration).toContain('ADD COLUMN "runToken" UUID');
    expect(migration).toContain('CREATE TABLE report_generation_outbox');
    expect(migration.indexOf("status = 'FAILED'::\"ReportStatus\"")).toBeLessThan(
      migration.indexOf('CREATE UNIQUE INDEX report_history_one_processing_period_idx'),
    );
  });
});

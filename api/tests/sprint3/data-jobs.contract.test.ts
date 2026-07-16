import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qaExportQuerySchema } from '../../src/validators/qaExternaRegistrosValidator';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  close: vi.fn(),
  dataJobCreate: vi.fn(),
  dataJobFindMany: vi.fn(),
  dataJobFindFirst: vi.fn(),
  dataJobUpdateMany: vi.fn(),
  dataJobDelete: vi.fn(),
}));

vi.mock('../../src/config/queue', () => ({
  createQueue: () => ({ add: mocks.add, getJob: mocks.getJob, close: mocks.close }),
  createWorker: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({
  default: {
    dataJob: {
      create: mocks.dataJobCreate,
      findMany: mocks.dataJobFindMany,
      findFirst: mocks.dataJobFindFirst,
      updateMany: mocks.dataJobUpdateMany,
      delete: mocks.dataJobDelete,
    },
  },
}));

vi.mock('../../src/services/vehicleImportService', () => ({
  importVehiclesFromFile: vi.fn(),
  publicImportErrorMessage: vi.fn(() => 'Error público'),
}));

vi.mock('../../src/jobs/refreshViewsJob', () => ({
  refreshMaterializedViews: vi.fn(),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import {
  cleanupExpiredDataJobs,
  createQaExportJob,
  createVehicleImportJob,
  getLatestOwnedActiveDataJob,
  isManagedDataJobArtifactName,
  MAX_STORED_IMPORT_ISSUES,
  MAX_STORED_IMPORT_MESSAGE_LENGTH,
  recoverStaleDataJobs,
  sanitizeImportResultForStorage,
} from '../../src/services/dataJobService';

function dataJob(type: 'QA_EXPORT' | 'VEHICLE_IMPORT', id: number) {
  const now = new Date('2026-07-15T12:00:00.000Z');
  return {
    id,
    type,
    status: 'QUEUED',
    requestedById: 7,
    payload: {},
    progress: 0,
    originalFileName: null,
    inputPath: null,
    artifactPath: null,
    artifactName: null,
    artifactSize: null,
    result: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    expiresAt: now,
    createdAt: now,
    updatedAt: now,
  } as const;
}

describe('contratos de DataJob Sprint 3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJob.mockResolvedValue(null);
    mocks.add.mockResolvedValue({ id: 'queued' });
  });

  it('publica export QA con job determinista y tres reintentos', async () => {
    mocks.dataJobCreate.mockResolvedValue(dataJob('QA_EXPORT', 51));
    await createQaExportJob({
      requestedById: 7,
      programa: 'BUFFALO',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateToExclusive: new Date('2026-08-01T00:00:00.000Z'),
      maxRecords: 50_000,
    });

    expect(mocks.add).toHaveBeenCalledWith(
      'generate-qa-export',
      { dataJobId: 51 },
      expect.objectContaining({ jobId: 'data-job-51', attempts: 3 }),
    );
  });

  it('no reintenta automáticamente una importación parcialmente confirmable', async () => {
    mocks.dataJobCreate.mockResolvedValue(dataJob('VEHICLE_IMPORT', 52));
    await createVehicleImportJob({
      requestedById: 7,
      inputPath: path.resolve('uploads/vehicle-imports/input.xlsx'),
      originalFileName: 'flota.xlsx',
      maxRows: 10_000,
    });

    expect(mocks.add).toHaveBeenCalledWith(
      'import-vehicles',
      { dataJobId: 52 },
      expect.objectContaining({ jobId: 'data-job-52', attempts: 1 }),
    );
  });

  it('traduce la unicidad parcial de un job activo a conflicto', async () => {
    mocks.dataJobCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('active job exists', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(createQaExportJob({
      requestedById: 7,
      programa: 'LX',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateToExclusive: new Date('2026-07-02T00:00:00.000Z'),
      maxRecords: 50_000,
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('recupera el job activo owner-scoped aunque se haya perdido sessionStorage', async () => {
    const active = { ...dataJob('VEHICLE_IMPORT', 59), status: 'PROCESSING' as const };
    mocks.dataJobFindFirst.mockResolvedValue(active);

    await expect(getLatestOwnedActiveDataJob(7, 'VEHICLE_IMPORT')).resolves.toEqual(active);
    expect(mocks.dataJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        requestedById: 7,
        type: 'VEHICLE_IMPORT',
        status: { in: ['QUEUED', 'PROCESSING'] },
      }),
      orderBy: { createdAt: 'desc' },
    }));

    const vehicleRoute = fs.readFileSync(path.resolve('src/routes/vehicleImportRouter.ts'), 'utf8');
    const qaRoute = fs.readFileSync(path.resolve('src/routes/qaExternaRegistrosRouter.ts'), 'utf8');
    expect(vehicleRoute.indexOf("'/import/active'")).toBeLessThan(
      vehicleRoute.indexOf("'/import/:jobId'"),
    );
    expect(qaRoute.indexOf("'/exports/active'")).toBeLessThan(
      qaRoute.indexOf("'/exports/:jobId'"),
    );
  });

  it('reencola export huérfano pero falla import huérfano sin reejecutarlo', async () => {
    const staleAt = new Date('2026-07-15T10:00:00.000Z');
    const exportBull = {
      getState: vi.fn().mockResolvedValue('failed'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const importBull = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mocks.dataJobFindMany.mockResolvedValue([
      { id: 61, type: 'QA_EXPORT', updatedAt: staleAt },
      { id: 62, type: 'VEHICLE_IMPORT', updatedAt: staleAt },
    ]);
    mocks.getJob.mockResolvedValueOnce(exportBull).mockResolvedValueOnce(importBull);
    mocks.dataJobUpdateMany.mockResolvedValue({ count: 1 });

    await expect(recoverStaleDataJobs()).resolves.toEqual({
      exportsRequeued: 1,
      importsFailed: 1,
    });
    expect(mocks.dataJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 61, status: 'PROCESSING' }),
      data: expect.objectContaining({ status: 'QUEUED', progress: 0 }),
    }));
    expect(mocks.dataJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 62, status: 'PROCESSING' }),
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(importBull.remove).toHaveBeenCalledOnce();
  });

  it('republica una intención durable si el Bull job homónimo está terminal', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      remove,
    });
    mocks.dataJobCreate.mockResolvedValue(dataJob('QA_EXPORT', 63));

    await createQaExportJob({
      requestedById: 7,
      programa: 'LX',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateToExclusive: new Date('2026-07-02T00:00:00.000Z'),
      maxRecords: 50_000,
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      'generate-qa-export',
      { dataJobId: 63 },
      expect.objectContaining({ jobId: 'data-job-63' }),
    );
  });

  it('no borra la fila vencida si una ruta no está confinada/limpiable', async () => {
    mocks.dataJobFindMany.mockResolvedValue([{
      ...dataJob('VEHICLE_IMPORT', 64),
      status: 'FAILED',
      inputPath: path.resolve('outside-imports/input.xlsx'),
    }]);

    await expect(cleanupExpiredDataJobs()).resolves.toBe(0);
    expect(mocks.dataJobDelete).not.toHaveBeenCalled();
  });

  it('solo reconoce artefactos QA inmutables y temporales con nombre estricto', () => {
    const token = 'a'.repeat(32);
    expect(isManagedDataJobArtifactName(`qa-externa-buffalo-81_a${token}.zip`)).toBe(true);
    expect(isManagedDataJobArtifactName(
      `.qa-externa-lx-81_a${token}.zip.${token}.tmp.zip`,
    )).toBe(true);
    expect(isManagedDataJobArtifactName(
      `.qa-externa-lx-81_a${token}.zip.${token}.tmp.zip.${token}.xlsx`,
    )).toBe(true);
    expect(isManagedDataJobArtifactName('../qa-externa-buffalo-81.zip')).toBe(false);
    expect(isManagedDataJobArtifactName('reporte_mensual_2026_07_r81.pdf')).toBe(false);
  });

  it('persiste resultado de importación acotado y sin datos internos de la fila', () => {
    const errors = Array.from({ length: 600 }, (_, index) => ({
      row: index + 2,
      message: `error-${index}-${'x'.repeat(2_000)}`,
      data: { tokenInterno: `secreto-${index}`, raw: 'z'.repeat(10_000) },
    }));
    const warnings = Array.from({ length: 600 }, (_, index) => ({
      row: index + 2,
      message: `warning-${index}-${'y'.repeat(2_000)}`,
    }));
    const stored = sanitizeImportResultForStorage({
      total: 1_200,
      created: 0,
      updated: 0,
      skipped: 0,
      errors,
      warnings,
    });
    const serialized = JSON.stringify(stored);
    const storedErrors = stored.errors as { row: number; message: string }[];

    expect(storedErrors).toHaveLength(MAX_STORED_IMPORT_ISSUES);
    expect(stored.warnings).toHaveLength(MAX_STORED_IMPORT_ISSUES);
    expect(storedErrors[0]).toEqual({
      row: 2,
      message: errors[0].message.slice(0, MAX_STORED_IMPORT_MESSAGE_LENGTH),
    });
    expect(stored.errorsTruncated).toBe(100);
    expect(stored.warningsTruncated).toBe(100);
    expect(serialized).not.toContain('tokenInterno');
    expect(serialized).not.toContain('secreto-');
    expect(serialized.length).toBeLessThan(600_000);
  });

  it('exige rango QA y limita a 366 días', () => {
    expect(qaExportQuerySchema.safeParse({
      programa: 'BUFFALO',
      dateFrom: '2025-01-01',
      dateTo: '2026-01-01',
    }).success).toBe(true);
    expect(qaExportQuerySchema.safeParse({
      programa: 'BUFFALO',
      dateFrom: '2025-01-01',
      dateTo: '2026-01-02',
    }).success).toBe(false);
  });

  it('la migración impide dos jobs activos del mismo owner/tipo', () => {
    const migration = fs.readFileSync(
      path.resolve('prisma/migrations/20260715040000_data_jobs/migration.sql'),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE "data_jobs"');
    expect(migration).toContain('data_jobs_one_active_per_owner_type');
    expect(migration).toContain("WHERE \"status\" IN ('QUEUED', 'PROCESSING')");
    expect(migration).toContain('data_jobs_progress_check');
  });
});

import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const reportsDir = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encuestas-export-jobs-'));
  process.env.REPORTS_DIR = dir;
  return dir;
});

const jobs = vi.hoisted(() => ({
  create: vi.fn(),
  active: vi.fn(),
  owned: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({ default: {} }));
vi.mock('../../src/services/dataJobService', () => ({
  createEncuestasExportJob: jobs.create,
  getLatestOwnedActiveDataJob: jobs.active,
  getOwnedDataJob: jobs.owned,
  serializeDataJob: (job: unknown) => job,
}));

import encuestasRouter from '../../src/routes/encuestasRevisionRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { Roles } from '../../src/middlewares/roleMiddleware';

function dataJob(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-25T12:00:00.000Z');
  return {
    id: 71,
    type: 'ENCUESTAS_EXPORT',
    status: 'QUEUED',
    requestedById: 9,
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
    expiresAt: new Date('2026-08-26T12:00:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function app(role = Roles.REVISOR_QA) {
  const instance = express();
  instance.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { userId: 9, email: 'revisor@example.invalid', role };
    next();
  });
  instance.use('/api/encuestas', encuestasRouter);
  instance.use(errorHandler);
  return instance;
}

const FILTERS = {
  dateFrom: '2026-08-01',
  dateTo: '2026-08-31',
  estado: 'noElegible',
  conAudio: 'false',
};

describe('DataJob de exportación ZIP de encuestas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.create.mockResolvedValue(dataJob());
    jobs.active.mockResolvedValue(null);
  });

  afterAll(() => fs.rmSync(reportsDir, { recursive: true, force: true }));

  it('crea un job acotado y conserva los filtros tipados', async () => {
    const response = await request(app())
      .post('/api/encuestas/exports')
      .query(FILTERS);

    expect(response.status).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith({
      requestedById: 9,
      dateFrom: new Date('2026-08-01T00:00:00.000Z'),
      dateToExclusive: new Date('2026-09-01T00:00:00.000Z'),
      dateTo: '2026-08-31',
      maxRecords: 50_000,
      dispositivo: undefined,
      estado: 'noElegible',
      conAudio: false,
    });
    expect(response.body.data.type).toBe('ENCUESTAS_EXPORT');
  });

  it('exige rango válido y rol REVISOR_QA', async () => {
    expect((await request(app()).post('/api/encuestas/exports')).status).toBe(400);
    expect(
      (await request(app(Roles.ADMIN)).post('/api/encuestas/exports').query(FILTERS)).status,
    ).toBe(403);
    expect(jobs.create).not.toHaveBeenCalled();
  });

  it('recupera el job activo por owner y tipo', async () => {
    jobs.active.mockResolvedValue(dataJob({ status: 'PROCESSING', progress: 42 }));

    const response = await request(app()).get('/api/encuestas/exports/active');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data.progress).toBe(42);
    expect(jobs.active).toHaveBeenCalledWith(9, 'ENCUESTAS_EXPORT');
  });

  it('consulta un job sin que /:id capture la ruta exports', async () => {
    jobs.owned.mockResolvedValue(dataJob());

    const response = await request(app()).get('/api/encuestas/exports/71');

    expect(response.status).toBe(200);
    expect(jobs.owned).toHaveBeenCalledWith(71, 9, 'ENCUESTAS_EXPORT');
  });

  it('sirve el ZIP completado con nombre público y sin cache', async () => {
    const dataJobsDir = path.join(reportsDir, 'data-jobs');
    fs.mkdirSync(dataJobsDir, { recursive: true });
    const artifactPath = path.join(
      dataJobsDir,
      `encuestas-export-71_a${'a'.repeat(32)}.zip`,
    );
    fs.writeFileSync(artifactPath, Buffer.from('PK\u0003\u0004zip-prueba'));
    jobs.owned.mockResolvedValue(dataJob({
      status: 'COMPLETED',
      artifactPath,
      artifactName: 'encuestas-2026-08-01_2026-08-31.zip',
    }));

    const response = await request(app()).get('/api/encuestas/exports/71/download');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toContain(
      'encuestas-2026-08-01_2026-08-31.zip',
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(jobs.owned).toHaveBeenCalledWith(71, 9, 'ENCUESTAS_EXPORT');
  });
});

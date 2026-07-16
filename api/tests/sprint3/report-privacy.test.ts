import fs from 'node:fs';
import path from 'node:path';
import type { ReportHistory } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/queue', () => ({
  createQueue: () => ({ close: vi.fn() }),
}));
vi.mock('../../src/lib/prisma', () => ({ default: {} }));

import { serializeReportHistoryForClient } from '../../src/services/reportService';

describe('privacidad de artefactos de reporte', () => {
  it('no expone rutas, lease, token ni excepción histórica', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const serialized = serializeReportHistoryForClient({
      id: 9,
      month: 6,
      year: 2026,
      pdfPath: '/app/storage/reports/internal.pdf',
      excelPath: '/app/storage/reports/internal.xlsx',
      pdfSize: 100,
      excelSize: 200,
      status: 'FAILED',
      requestedBy: 'admin@example.test',
      errorMessage: 'password=secret at /app/worker.py SQL SELECT',
      runToken: '123e4567-e89b-12d3-a456-426614174000',
      leaseExpiresAt: now,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    } satisfies ReportHistory);
    const json = JSON.stringify(serialized);

    expect(serialized.pdfPath).toBe('available');
    expect(serialized.excelPath).toBe('available');
    expect(serialized.errorMessage).toBe('No se pudo generar el reporte; reintenta más tarde');
    expect(json).not.toContain('/app/');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('runToken');
    expect(json).not.toContain('leaseExpiresAt');
  });

  it('descargas de reportes usan no-store', () => {
    const source = fs.readFileSync(path.resolve('src/routes/reportRouter.ts'), 'utf8');
    expect(source).toContain("cacheControl: 'private, no-store'");
    expect(source).not.toContain('res.download');
    expect(source).not.toContain('existsSync');
  });
});

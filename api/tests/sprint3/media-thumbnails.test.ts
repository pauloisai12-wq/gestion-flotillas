import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  close: vi.fn(),
  upsertJobScheduler: vi.fn(),
}));

vi.mock('../../src/config/queue', () => ({
  createQueue: () => ({
    add: mocks.add,
    getJob: mocks.getJob,
    close: mocks.close,
    upsertJobScheduler: mocks.upsertJobScheduler,
  }),
  createWorker: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({
  default: {
    qaExternaImagen: { findMany: vi.fn() },
    ticketAttachment: { findMany: vi.fn() },
  },
}));

import {
  enqueueThumbnailBackfill,
  enqueueQaThumbnail,
  qaThumbnailPath,
  runResilientThumbnailBatch,
  scheduleThumbnailBackfill,
  ticketThumbnailPath,
} from '../../src/services/mediaThumbnailService';
import { attachmentThumbnailFileUrl } from '../../src/services/tickets/fileAccess';

describe('miniaturas privadas Sprint 3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJob.mockResolvedValue(null);
    mocks.add.mockResolvedValue({ id: 'queued' });
  });

  it('deriva miniaturas privadas sin conservar la extensión original', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(attachmentThumbnailFileUrl(17, 31))
      .toBe('/api/maintenance-tickets/17/attachments/31/thumbnail');
    expect(ticketThumbnailPath(`${id}.png`)).toMatch(new RegExp(`${id}\\.webp$`));
  });

  it('usa hash QA y rechaza nombres manipulados', () => {
    const digest = 'b'.repeat(64);
    expect(qaThumbnailPath('LX', digest)).toMatch(/thumbnails[\\/]lx[\\/][b]{64}\.webp$/);
    expect(() => qaThumbnailPath('LX', '../escape')).toThrow('Hash QA inválido');
  });

  it('fija 512px, WebP y publicación sin sobrescritura', () => {
    const source = fs.readFileSync(
      path.resolve('src/services/mediaThumbnailService.ts'),
      'utf8',
    );
    expect(source).toContain('const THUMBNAIL_SIZE = 512');
    expect(source).toContain('const MAX_THUMBNAIL_INPUT_PIXELS = 40_000_000');
    expect(source).toContain('.webp({ quality: THUMBNAIL_QUALITY');
    expect(source).toContain('COPYFILE_EXCL');
    expect(source).toContain("'thumbnail-backfill-v1'");
  });

  it('una imagen corrupta no impide procesar las filas posteriores', async () => {
    const visited: number[] = [];
    const result = await runResilientThumbnailBatch([1, 2, 3], async (value) => {
      visited.push(value);
      if (value === 1) throw new Error('corrupta');
    });
    expect(visited).toEqual([1, 2, 3]);
    expect(result).toEqual({ completed: 2, failed: 1 });
  });

  it('retira un job terminal fallido antes de reencolar la miniatura', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
      remove,
    });
    mocks.add.mockResolvedValueOnce({ id: 'new-job' });
    const digest = 'c'.repeat(64);

    await enqueueQaThumbnail('BUFFALO', digest);

    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      'qa-thumbnail',
      { kind: 'QA', programa: 'BUFFALO', sha256: digest },
      expect.objectContaining({ jobId: `qa-thumb-buffalo-${digest}` }),
    );
  });

  it('un backfill posterior retira el job completado y vuelve a ejecutarse', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.getJob.mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      remove,
    });

    await enqueueThumbnailBackfill();

    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith(
      'thumbnail-backfill',
      { kind: 'BACKFILL' },
      expect.objectContaining({ jobId: 'thumbnail-backfill-v1' }),
    );
  });

  it('programa recuperación periódica sin IDs manuales solapables', async () => {
    await scheduleThumbnailBackfill();

    expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
      'thumbnail-backfill-scheduler-v1',
      { every: 15 * 60 * 1000 },
      expect.objectContaining({
        name: 'thumbnail-backfill',
        data: { kind: 'BACKFILL' },
      }),
    );
  });
});

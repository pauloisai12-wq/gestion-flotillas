import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { sendPrivateFile } from '../../src/lib/privateFileResponse';

const temporaryDirectories: string[] = [];

function responseSink() {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string | number>();
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const target = sink as Writable & {
    headersSent: boolean;
    statusCode: number;
    setHeader: (name: string, value: string | number) => typeof target;
    status: (code: number) => typeof target;
    type: (value: string) => typeof target;
    attachment: (name: string) => typeof target;
    vary: (value: string) => typeof target;
  };
  target.headersSent = false;
  target.statusCode = 200;
  target.setHeader = (name, value) => {
    headers.set(name.toLowerCase(), value);
    return target;
  };
  target.status = (code) => {
    target.statusCode = code;
    return target;
  };
  target.type = (value) => target.setHeader('Content-Type', value);
  target.attachment = (name) => {
    target.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return target;
  };
  target.vary = (value) => target.setHeader('Vary', value);
  return { response: target as unknown as Response, chunks, headers };
}

async function fixtureFile(content: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), 'tests', '.private-file-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'artifact.zip');
  await fs.writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('stream privado sin TOCTOU', () => {
  it('HEAD de export QA conserva el mismo middleware de rol y handler que GET', async () => {
    const source = await fs.readFile(
      path.resolve('src/routes/qaExternaRegistrosRouter.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /router\.head\(\s*'\/exports\/:jobId\/download',\s*requireRole\(\[Roles\.REVISOR_QA\]\),\s*downloadQaExport/s,
    );
    expect(source).toMatch(
      /router\.get\(\s*'\/exports\/:jobId\/download',\s*requireRole\(\[Roles\.REVISOR_QA\]\),\s*downloadQaExport/s,
    );
    expect(source).not.toContain('existsSync');
    expect(source).not.toContain('res.download');
    expect(source).not.toContain('createReadStream');
    expect(source).toContain("cacheControl: 'private, no-store'");
    expect(source).toContain("cacheControl: 'private, max-age=3600, must-revalidate'");
    expect(source).toContain('varyCookie: true');
  });

  it('/uploads separa caché por sesión y ya no declara evidencia immutable', async () => {
    const source = await fs.readFile(path.resolve('src/index.ts'), 'utf8');
    expect(source).toContain("maxAge: '1h'");
    expect(source).toContain('immutable: false');
    expect(source).toContain("'private, max-age=3600, must-revalidate'");
    expect(source).toContain("res.setHeader('Vary', 'Cookie')");
    expect(source).not.toContain("'private, max-age=2592000, immutable'");
  });

  it('HEAD conserva headers de descarga y no lee el cuerpo', async () => {
    const filePath = await fixtureFile('contenido-privado');
    const sink = responseSink();

    await expect(sendPrivateFile(
      { method: 'HEAD' } as Request,
      sink.response,
      filePath,
      {
        downloadName: 'exportacion.zip',
        cacheControl: 'private, max-age=60',
        varyCookie: true,
      },
    )).resolves.toBe(true);

    expect(Buffer.concat(sink.chunks)).toHaveLength(0);
    expect(sink.headers.get('content-length')).toBe(Buffer.byteLength('contenido-privado'));
    expect(sink.headers.get('cache-control')).toBe('private, max-age=60');
    expect(sink.headers.get('content-disposition')).toContain('exportacion.zip');
    expect(sink.headers.get('vary')).toBe('Cookie');
  });

  it('GET transmite desde el descriptor abierto y una ruta ausente responde false', async () => {
    const filePath = await fixtureFile('zip-stream');
    const sink = responseSink();
    await expect(sendPrivateFile(
      { method: 'GET' } as Request,
      sink.response,
      filePath,
      { contentType: 'application/zip', cacheControl: 'private' },
    )).resolves.toBe(true);
    expect(Buffer.concat(sink.chunks).toString('utf8')).toBe('zip-stream');

    const missing = responseSink();
    await expect(sendPrivateFile(
      { method: 'GET' } as Request,
      missing.response,
      `${filePath}.missing`,
      { contentType: 'application/zip', cacheControl: 'private' },
    )).resolves.toBe(false);
  });
});

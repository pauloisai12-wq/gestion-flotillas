const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/flotillas_test';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'x'.repeat(64);
process.env.TURNSTILE_ENABLED = 'false';

const express = require('express');
const multer = require('multer');
const { z } = require('zod/v4');
const { validateBody } = require('../dist/middlewares/validate');
const {
  cleanupUploadedFilesOnError,
  ensureUploadDirectories,
  UPLOAD_DIRS,
} = require('../dist/lib/uploadStorage');

async function main() {
  ensureUploadDirectories();
  await Promise.all(
    Object.values(UPLOAD_DIRS).map((directory) => fs.access(directory, constants.W_OK)),
  );

  const filename = `cleanup-test-${crypto.randomUUID()}.pdf`;
  const absolutePath = path.join(UPLOAD_DIRS.maintenanceTicketQuotes, filename);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIRS.maintenanceTicketQuotes),
    filename: (_req, _file, cb) => cb(null, filename),
  });
  const upload = multer({ storage, limits: { files: 1, fields: 2, parts: 3 } });

  const app = express();
  app.post(
    '/quote',
    upload.single('pdf'),
    validateBody(z.object({ amount: z.coerce.number().positive() })),
    (_req, res) => res.sendStatus(204),
    cleanupUploadedFilesOnError,
  );
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });

  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');

    const form = new FormData();
    form.append('pdf', new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), 'quote.pdf');
    const response = await fetch(`http://127.0.0.1:${address.port}/quote`, {
      method: 'POST',
      body: form,
    });

    assert.equal(response.status, 400, 'la validación posterior a Multer debe fallar');
    await assert.rejects(fs.access(absolutePath), { code: 'ENOENT' });
    console.log('OK: directorios escribibles y cleanup posterior a Multer verificado');
  } finally {
    await fs.unlink(absolutePath).catch(() => undefined);
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

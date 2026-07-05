const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const servicePath = path.resolve(__dirname, '..', 'src', 'services', 'qaExternaService.ts');
const source = fs.readFileSync(servicePath, 'utf8');

function loadService() {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: servicePath,
  }).outputText;

  const serviceModule = new Module(servicePath, module);
  serviceModule.filename = servicePath;
  serviceModule.paths = Module._nodeModulePaths(path.dirname(servicePath));

  const originalRequire = serviceModule.require.bind(serviceModule);
  serviceModule.require = (request) => {
    if (request === '../lib/prisma') {
      return { __esModule: true, default: {} };
    }
    if (request === '../middlewares/errorHandler') {
      return {
        isPrismaKnownError: (error, code) =>
          error?.name === 'PrismaClientKnownRequestError' &&
          (!code || error.code === code),
      };
    }
    if (request === '../lib/qaExternaStorage') {
      return { processImage: async () => { throw new Error('unexpected processImage call'); } };
    }
    return originalRequire(request);
  };

  serviceModule._compile(compiled, servicePath);
  return serviceModule.exports;
}

const { ingestWithDeps } = loadService();

const input = {
  clienteRegistroId: '11111111-1111-1111-1111-111111111111',
  dispositivoId: 7,
  identificadorApp: 'test-app',
  tipo: 'lona',
  programa: 'BUFFALO',
  lat: 19.432608,
  lng: -99.133209,
  accuracy: 5,
  capturadoAt: new Date('2026-06-15T18:30:00.000Z'),
  notas: null,
  metadataRaw: '{"tipo":"lona","notas":null}',
  buffers: [Buffer.from('fake-jpeg')],
};

const storedImage = {
  sha256: 'a'.repeat(64),
  ruta: 'qa-externa/buffalo/image.jpg',
  mime: 'image/jpeg',
  bytes: 9,
  width: 1,
  height: 1,
};

function p2002(target) {
  const error = new Error('Unique constraint failed');
  error.name = 'PrismaClientKnownRequestError';
  error.code = 'P2002';
  error.meta = { target };
  return error;
}

function createDeps(options = {}) {
  const state = {
    events: [],
    processImageCalls: 0,
    transactionCalls: 0,
    txs: [],
  };

  function maybeThrow(attempt, operation) {
    const failure = options.failByAttempt?.[attempt];
    if (failure?.operation === operation) throw failure.error;
  }

  const deps = {
    processImage: async () => {
      state.processImageCalls += 1;
      state.events.push(`processImage:${state.processImageCalls}`);
      if (options.processImageError) throw options.processImageError;
      return storedImage;
    },
    db: {
      $transaction: async (callback) => {
        state.transactionCalls += 1;
        const attempt = state.transactionCalls;
        const tx = {
          attempt,
          qaExternaRegistro: {
            upsert: async () => {
              state.events.push(`tx${attempt}:registro.upsert`);
              maybeThrow(attempt, 'registro.upsert');
              return { id: 100 + attempt };
            },
            update: async () => {
              state.events.push(`tx${attempt}:registro.update`);
              return { id: 100 + attempt };
            },
          },
          qaExternaImagen: {
            upsert: async () => {
              state.events.push(`tx${attempt}:imagen.upsert`);
              maybeThrow(attempt, 'imagen.upsert');
              return {
                id: 200 + attempt,
                sha256: storedImage.sha256,
                bytes: storedImage.bytes,
                mime: storedImage.mime,
                width: storedImage.width,
                height: storedImage.height,
              };
            },
            findUniqueOrThrow: async () => {
              state.events.push(`tx${attempt}:imagen.findUniqueOrThrow`);
              return {
                id: 200 + attempt,
                sha256: storedImage.sha256,
                bytes: storedImage.bytes,
                mime: storedImage.mime,
                width: storedImage.width,
                height: storedImage.height,
              };
            },
          },
          qaExternaRegistroImagen: {
            createMany: async () => {
              state.events.push(`tx${attempt}:pivot.createMany`);
              return { count: 1 };
            },
          },
        };
        state.txs.push(tx);
        return callback(tx);
      },
    },
  };

  return { deps, state };
}

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected function to throw');
}

async function testRegistroP2002RetriesInNewTransaction() {
  const firstError = p2002(['clienteRegistroId']);
  const { deps, state } = createDeps({
    failByAttempt: { 1: { operation: 'registro.upsert', error: firstError } },
  });

  const result = await ingestWithDeps(input, deps);

  assert.equal(result.registroId, 102);
  assert.equal(state.transactionCalls, 2);
  assert.notEqual(state.txs[0], state.txs[1]);
  assert.equal(state.processImageCalls, 1);
  assert.equal(state.events.includes('tx1:registro.update'), false);
}

async function testImagenP2002RetriesInNewTransaction() {
  const firstError = p2002(['sha256', 'programa']);
  const { deps, state } = createDeps({
    failByAttempt: { 1: { operation: 'imagen.upsert', error: firstError } },
  });

  const result = await ingestWithDeps(input, deps);

  assert.equal(result.imagenes[0].id, 202);
  assert.equal(state.transactionCalls, 2);
  assert.notEqual(state.txs[0], state.txs[1]);
  assert.equal(state.processImageCalls, 1);
  assert.equal(state.events.includes('tx1:imagen.findUniqueOrThrow'), false);
}

async function testNonP2002DoesNotRetry() {
  const dbError = new Error('database unavailable');
  const { deps, state } = createDeps({
    failByAttempt: { 1: { operation: 'registro.upsert', error: dbError } },
  });

  const thrown = await captureError(() => ingestWithDeps(input, deps));

  assert.equal(thrown, dbError);
  assert.equal(state.transactionCalls, 1);
}

async function testP2002RetryLimit() {
  const firstError = p2002(['clienteRegistroId']);
  const secondError = p2002(['clienteRegistroId']);
  const { deps, state } = createDeps({
    failByAttempt: {
      1: { operation: 'registro.upsert', error: firstError },
      2: { operation: 'registro.upsert', error: secondError },
    },
  });

  const thrown = await captureError(() => ingestWithDeps(input, deps));

  assert.equal(thrown, secondError);
  assert.equal(state.transactionCalls, 2);
}

async function testProcessImageFailureDoesNotOpenTransaction() {
  const imageError = new Error('invalid image');
  const { deps, state } = createDeps({ processImageError: imageError });

  const thrown = await captureError(() => ingestWithDeps(input, deps));

  assert.equal(thrown, imageError);
  assert.equal(state.processImageCalls, 1);
  assert.equal(state.transactionCalls, 0);
}

function testSourceShape() {
  const processImageIndex = source.indexOf('storedImages.push(await deps.processImage');
  const transactionIndex = source.indexOf('deps.db.$transaction');
  const outerCatchIndex = source.indexOf("if (isPrismaKnownError(e, 'P2002'))");

  assert.notEqual(processImageIndex, -1, 'ingest must process images before DB writes');
  assert.notEqual(transactionIndex, -1, 'ingest must wrap DB writes in a transaction');
  assert.notEqual(outerCatchIndex, -1, 'ingest must retry P2002 outside the transaction');
  assert(processImageIndex < transactionIndex, 'image processing must happen before the DB transaction');
  assert(transactionIndex < outerCatchIndex, 'P2002 handling must be outside the DB transaction callback');
  assert.equal(source.includes('tx.qaExternaRegistro.update'), false);
  assert.equal(source.includes('tx.qaExternaImagen.findUniqueOrThrow'), false);
}

(async () => {
  testSourceShape();
  await testRegistroP2002RetriesInNewTransaction();
  await testImagenP2002RetriesInNewTransaction();
  await testNonP2002DoesNotRetry();
  await testP2002RetryLimit();
  await testProcessImageFailureDoesNotOpenTransaction();
  console.log('qa_externa ingest consistency check passed');
})();

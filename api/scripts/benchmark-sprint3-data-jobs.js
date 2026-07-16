const { performance } = require('node:perf_hooks');
const XLSX = require('xlsx');

const LOOKUP_BATCH_SIZE = 500;
const MAX_ROWS = 10_000;
const MAX_PARSE_MS = Number(process.env.SPRINT3_BENCH_MAX_PARSE_MS || 15_000);
const MAX_HEAP_DELTA_MIB = Number(process.env.SPRINT3_BENCH_MAX_HEAP_MIB || 256);
const sizes = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const sampleSizes = sizes.length ? sizes : [1_000, 5_000, 10_000];

if (sampleSizes.some((size) => size > MAX_ROWS)) {
  throw new Error(`El benchmark respeta el máximo productivo de ${MAX_ROWS} filas`);
}
if (!Number.isFinite(MAX_PARSE_MS) || MAX_PARSE_MS <= 0) {
  throw new Error('SPRINT3_BENCH_MAX_PARSE_MS debe ser positivo');
}
if (!Number.isFinite(MAX_HEAP_DELTA_MIB) || MAX_HEAP_DELTA_MIB <= 0) {
  throw new Error('SPRINT3_BENCH_MAX_HEAP_MIB debe ser positivo');
}

const results = [];
for (const size of sampleSizes) {
  const rows = [['Placa', 'No Economico', 'Expediente', 'VIN', 'Marca']];
  for (let index = 0; index < size; index += 1) {
    rows.push([
      `PL-${index}`,
      `ECO-${index}`,
      `EXP-${index}`,
      `VIN-${String(index).padStart(12, '0')}`,
      'MARCA',
    ]);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Flota');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const parsedWorkbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const parsedRows = XLSX.utils.sheet_to_json(
    parsedWorkbook.Sheets[parsedWorkbook.SheetNames[0]],
    { header: 1, defval: null, blankrows: false },
  );
  const elapsedMs = performance.now() - start;
  const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);
  if (parsedRows.length !== size + 1) throw new Error('Conteo parseado inconsistente');

  results.push({
    rows: size,
    xlsxMiB: Number((buffer.length / (1024 * 1024)).toFixed(2)),
    parseMs: Number(elapsedMs.toFixed(1)),
    heapDeltaMiB: Number(heapDeltaMiB.toFixed(2)),
    legacyIdentifierQueries: size * 4,
    batchedIdentifierQueriesUpperBound: Math.ceil(size / LOOKUP_BATCH_SIZE),
  });
}

console.table(results);
console.log(JSON.stringify({
  maxRows: MAX_ROWS,
  lookupBatchSize: LOOKUP_BATCH_SIZE,
  thresholds: {
    maxParseMsPerSample: MAX_PARSE_MS,
    maxHeapDeltaMiBPerSample: MAX_HEAP_DELTA_MIB,
  },
  results,
}, null, 2));

const regressions = results.filter(
  (result) => result.parseMs > MAX_PARSE_MS || result.heapDeltaMiB > MAX_HEAP_DELTA_MIB,
);
if (regressions.length > 0) {
  console.error('REGRESION Sprint 3: el parser excedio los umbrales:', regressions);
  process.exitCode = 1;
}

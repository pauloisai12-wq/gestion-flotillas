const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const apiRoot = path.resolve(__dirname, '..');

class TestAppError extends Error {
  constructor(statusCode, message, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const errorHandlerMock = {
  BadRequest: (message, details) => new TestAppError(400, message, 'BAD_REQUEST', details),
  NotFound: (resource) => new TestAppError(404, `${resource} no encontrado`, 'NOT_FOUND'),
  Conflict: (message) => new TestAppError(409, message, 'CONFLICT'),
  isPrismaKnownError: (error, code) => Boolean(error && error.code === code),
};

function loadTypeScriptModule(relativePath, mocks) {
  const filename = path.join(apiRoot, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  const testModule = { exports: {} };
  const testRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return require(request);
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
    testModule.exports,
    testRequire,
    testModule,
    filename,
    path.dirname(filename),
  );
  return testModule.exports;
}

async function testVehicleConcurrencyAndSoftDelete() {
  const firstVersion = new Date('2026-07-15T12:00:00.000Z');
  const secondVersion = new Date('2026-07-15T12:01:00.000Z');
  let vehicle = {
    id: 7,
    isActive: true,
    updatedAt: firstVersion,
    currentOdometer: 5_000,
  };
  const writes = [];
  const auditRows = [];
  let listWhere;

  const vehicleDelegate = {
    findUnique: async () => ({ ...vehicle }),
    findFirst: async () => null,
    findMany: async ({ where }) => {
      listWhere = where;
      return [];
    },
    count: async () => 0,
    update: async (args) => {
      if (
        args.where.updatedAt &&
        new Date(args.where.updatedAt).getTime() !== vehicle.updatedAt.getTime()
      ) {
        throw { code: 'P2025' };
      }
      writes.push(args);
      vehicle = {
        ...vehicle,
        ...args.data,
        updatedAt: secondVersion,
      };
      return args.select
        ? { id: vehicle.id, currentOdometer: vehicle.currentOdometer, updatedAt: vehicle.updatedAt }
        : { ...vehicle, vehicleType: { name: 'Patrulla' } };
    },
  };
  const prismaMock = {
    vehicle: vehicleDelegate,
    $transaction: async (callback) => callback({
      vehicle: vehicleDelegate,
      auditLog: { create: async ({ data }) => auditRows.push(data) },
    }),
  };

  const service = loadTypeScriptModule('src/services/vehicleService.ts', {
    '../lib/prisma': { __esModule: true, default: prismaMock },
    '../middlewares/errorHandler': errorHandlerMock,
    '../lib/auditContext': {
      getAuditContext: () => ({ requestId: 'test-request', ipAddress: '127.0.0.1' }),
    },
    './vehicleDeactivationService': {
      deactivateVehicleInTransaction: async (tx, id) => ({
        vehicle: await tx.vehicle.update({
          where: { id, isActive: true },
          data: { isActive: false },
        }),
      }),
    },
  });

  const ordinaryEdit = {
    plate: 'ABC-123',
    economicNumber: 'ECO-007',
    vehicleTypeId: 1,
    classification: 'POLICIAL',
    brand: 'Ford',
    model: 'Interceptor',
    year: 2025,
    vin: null,
    color: 'Negro',
    expectedUpdatedAt: firstVersion.toISOString(),
  };

  await service.updateVehicle(7, ordinaryEdit);
  assert.equal(writes.length, 1);
  assert.equal('currentOdometer' in writes[0].data, false, 'PUT ordinario no debe tocar odómetro');
  assert.equal('isActive' in writes[0].data, false, 'PUT ordinario no debe reactivar/dar de baja');

  await assert.rejects(
    () => service.updateVehicle(7, ordinaryEdit),
    (error) => error.statusCode === 409 && /cambió desde que abriste/.test(error.message),
    'Una segunda edición con la misma versión debe recibir conflicto 409',
  );

  await service.getAllVehicles({ page: 1, limit: 20 });
  assert.equal(listWhere.isActive, true, 'La lista operativa debe ocultar bajas lógicas');

  const versionBeforeCorrection = vehicle.updatedAt.toISOString();
  await service.correctVehicleOdometer(
    7,
    { newOdometer: 4_900, reason: 'Corrección por lectura capturada erróneamente', expectedUpdatedAt: versionBeforeCorrection },
    99,
  );
  assert.equal(auditRows.length, 1);
  assert.deepEqual(auditRows[0].before, { currentOdometer: 5_000 });
  assert.deepEqual(auditRows[0].after, { currentOdometer: 4_900 });
  assert.equal(auditRows[0].action, 'ODOMETER_CORRECTION');

  await service.deleteVehicle(7, 99);
  const softDeleteWrite = writes.at(-1);
  assert.deepEqual(softDeleteWrite.data, { isActive: false });
  assert.equal(vehicle.isActive, false);
  assert.equal(prismaMock.document, undefined, 'La baja no debe borrar documentos');
  assert.equal(prismaMock.vehicleAssignment, undefined, 'La baja no debe borrar asignaciones');
}

async function testAuthoritativeMassDistribution() {
  const ids = Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }));
  const batchWrites = [];
  const budgetAuditRows = [];
  const rawQueries = [];
  const countQueries = [];

  const prismaMock = {
    vehicle: {
      count: async (query) => {
        countQueries.push(query);
        return countQueries.length === 1 ? 101 : 77;
      },
      groupBy: async () => [
        { classification: 'POLICIAL', _count: { _all: 40 } },
        { classification: 'ESTATAL', _count: { _all: 61 } },
      ],
    },
    $transaction: async (callback) => callback(transactionMock),
  };
  const transactionMock = {
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      rawQueries.push({ sql, values });
      if (sql.includes('pg_advisory_xact_lock')) return [{ pg_advisory_xact_lock: null }];
      if (sql.includes('FROM monthly_budgets')) return [{ totalAmount: '1010.00' }];
      return ids;
    },
    $executeRaw: async (query) => {
      batchWrites.push(query);
      return 101;
    },
    auditLog: { create: async ({ data }) => { budgetAuditRows.push(data); return data; } },
    vehicleBudget: {
      aggregate: async () => ({ _sum: { baseAmount: 0 } }),
      findMany: async () => [],
    },
  };

  const service = loadTypeScriptModule('src/services/budgetDistributionService.ts', {
    '../lib/prisma': { __esModule: true, default: prismaMock },
    '../lib/auditContext': { getAuditContext: () => ({}) },
    '../middlewares/errorHandler': errorHandlerMock,
    '../validators/budgetValidator': { MAX_BUDGET_DISTRIBUTIONS: 5_000 },
    './budgetPeriodLock': { lockOpenBudgetPeriod: async () => {} },
  });

  const counts = await service.getDistributionTargetCounts('FUEL', 2026, 7);
  assert.deepEqual(counts, {
    all: 101,
    unassigned: 77,
    byClassification: { POLICIAL: 40, ESTATAL: 61, VIAL: 0 },
  });
  assert.equal(countQueries[0].where.isActive, true);
  assert.deepEqual(
    countQueries[1].where.vehicleBudgets.none,
    { kind: 'FUEL', year: 2026, month: 7 },
  );

  const result = await service.distributeBudgetToTargetInTransaction(
    transactionMock,
    {
      kind: 'FUEL',
      year: 2026,
      month: 7,
      target: { mode: 'ALL' },
      allocation: { mode: 'TOTAL', amount: 1010 },
    },
    99,
  );
  assert.deepEqual(result, { count: 101, totalAmount: 1010 });
  assert.equal(batchWrites.length, 1, '101 unidades deben resolverse con un UPSERT set-based');
  assert.match(batchWrites[0].sql, /INSERT INTO vehicle_budgets/);
  assert.equal(
    batchWrites[0].values.filter((value) => value === '10.00').length,
    101,
    'Debe escribir también el vehículo 101 con el monto exacto',
  );
  assert.equal(budgetAuditRows.length, 1, 'La escritura set-based debe conservar auditoría');
  assert.equal(budgetAuditRows[0].action, 'BULK_UPSERT');
  assert.equal(budgetAuditRows[0].after.count, 101);
  assert.match(budgetAuditRows[0].metadata.allocationDigestSha256, /^[a-f0-9]{64}$/);
  const allTargetSql = rawQueries.find((query) => query.sql.includes('FROM vehicles v')).sql;
  assert.match(allTargetSql, /"isActive" = true/);
  assert.doesNotMatch(allTargetSql, /LIMIT/i, 'El universo no debe depender de una página');

  const centAllocations = service.buildBudgetAllocations([1, 2, 3], 'TOTAL', 1);
  assert.equal(
    centAllocations.reduce((sum, item) => sum + item.baseAmount, 0),
    1,
    'El reparto debe conservar exactamente los centavos del total',
  );
  assert.throws(
    () => service.moneyAmountToCents(0.009),
    (error) => error.statusCode === 400 && /dos decimales/.test(error.message),
    'Los contratos financieros no deben aceptar fracciones menores a un centavo',
  );

  rawQueries.length = 0;
  batchWrites.length = 0;
  await service.distributeBudgetToTargetInTransaction(
    { ...transactionMock, $queryRaw: transactionMock.$queryRaw },
    {
      kind: 'MAINTENANCE',
      year: 2026,
      month: 8,
      target: { mode: 'UNASSIGNED' },
      allocation: { mode: 'PER_UNIT', amount: 1 },
    },
    99,
  );
  assert.match(
    rawQueries.find((query) => query.sql.includes('FROM vehicles v')).sql,
    /NOT EXISTS/,
  );

  rawQueries.length = 0;
  await service.distributeBudgetToTargetInTransaction(
    transactionMock,
    {
      kind: 'FUEL',
      year: 2026,
      month: 9,
      target: { mode: 'CLASSIFICATION', classification: 'VIAL' },
      allocation: { mode: 'PER_UNIT', amount: 1 },
    },
    99,
  );
  const classificationQuery = rawQueries.find((query) => query.sql.includes('FROM vehicles v'));
  assert.match(classificationQuery.sql, /VehicleClassification/);
  assert.ok(classificationQuery.values.includes('VIAL'));

  const topupWrites = [];
  const topupTx = {
    $queryRaw: async (strings) => {
      const sql = strings.join(' ');
      if (sql.includes('FROM monthly_budgets')) return [{ totalAmount: '1000.00' }];
      if (sql.includes('FROM vehicles v')) return [{ id: 1 }];
      return [];
    },
    $executeRaw: async (query) => {
      topupWrites.push(query);
      return 1;
    },
    auditLog: { create: async ({ data }) => data },
    vehicleBudget: {
      aggregate: async () => ({ _sum: { baseAmount: 0 } }),
      findMany: async () => [{ vehicleId: 1, rolloverIn: '0.00', spentAmount: '100.00' }],
    },
  };
  await service.distributeBudgetToTargetInTransaction(
    topupTx,
    {
      kind: 'FUEL', year: 2026, month: 7,
      target: { mode: 'ALL' },
      allocation: { mode: 'PER_UNIT', amount: 150 },
    },
    99,
  );
  assert.ok(topupWrites[0].values.includes('150.00'));
  assert.ok(topupWrites[0].values.includes(false), 'Un top-up debe reabrir saldo disponible');
  await assert.rejects(
    () => service.distributeBudgetToTargetInTransaction(
      topupTx,
      {
        kind: 'FUEL', year: 2026, month: 7,
        target: { mode: 'ALL' },
        allocation: { mode: 'PER_UNIT', amount: 50 },
      },
      99,
    ),
    /menor que su gasto ya registrado/,
  );
}

async function testOperationalWritesRespectSoftDeleteAndOdometerLock() {
  let lockedVehicle = {
    id: 7,
    vehicleTypeId: 3,
    currentOdometer: 200,
    isActive: true,
  };
  let maintenanceCreates = 0;
  let odometerUpdates = 0;
  const lockOrder = [];
  const maintenanceTx = {
    $queryRaw: async () => {
      lockOrder.push('vehicle');
      return [{ ...lockedVehicle }];
    },
    serviceCatalog: {
      findUnique: async () => ({ id: 4, name: 'Servicio preventivo', vehicleTypeId: 3 }),
    },
    maintenanceRecord: {
      create: async ({ data }) => {
        maintenanceCreates += 1;
        return { id: maintenanceCreates, ...data };
      },
    },
    vehicle: {
      update: async () => {
        odometerUpdates += 1;
      },
    },
  };
  const maintenance = loadTypeScriptModule('src/services/maintenanceRecordService.ts', {
    '../lib/prisma': {
      __esModule: true,
      default: { $transaction: async (callback) => callback(maintenanceTx) },
    },
    '../middlewares/errorHandler': errorHandlerMock,
    './budgetPeriodLock': {
      lockOpenBudgetPeriod: async () => {
        lockOrder.push('period');
      },
    },
    '../lib/businessTime': { businessPeriodForDate: () => ({ year: 2026, month: 7 }) },
  });
  const input = {
    vehicleId: 7,
    serviceId: 4,
    odometer: 150,
    odometerStatus: 'OK',
    cost: 500,
    workshopId: 2,
    workshopRaw: null,
    serviceDate: '2026-07-15',
    notes: null,
  };

  await maintenance.create(input);
  assert.deepEqual(
    lockOrder.slice(0, 2),
    ['period', 'vehicle'],
    'Mantenimiento debe respetar el orden global periodo→vehículo',
  );
  assert.equal(maintenanceCreates, 1);
  assert.equal(
    odometerUpdates,
    0,
    'Una lectura inferior al valor bloqueado no debe reducir el odómetro maestro',
  );

  lockedVehicle = { ...lockedVehicle, isActive: false };
  await assert.rejects(
    () => maintenance.create({ ...input, odometer: 250 }),
    (error) => error.statusCode === 400 && /dado de baja/.test(error.message),
  );
  assert.equal(maintenanceCreates, 1, 'La baja debe impedir nuevos mantenimientos');

  let documentCreates = 0;
  const documents = loadTypeScriptModule('src/services/documentService.ts', {
    '../lib/prisma': {
      __esModule: true,
      default: {
        $transaction: async (callback) => callback({
          $queryRaw: async () => [{ id: 7, isActive: false }],
          document: {
            findFirst: async () => null,
            create: async () => {
              documentCreates += 1;
            },
          },
        }),
      },
    },
    '../middlewares/errorHandler': errorHandlerMock,
  });
  await assert.rejects(
    () => documents.createDocument({
      vehicleId: 7,
      type: 'INSURANCE',
      issuedAt: '2026-01-01',
      expiresAt: '2027-01-01',
      notes: null,
    }),
    (error) => error.statusCode === 409 && /solo lectura/.test(error.message),
  );
  assert.equal(documentCreates, 0, 'La baja debe impedir nuevos documentos');
}

async function testClosedPeriodAndPoolContracts() {
  const periodLock = loadTypeScriptModule('src/services/budgetPeriodLock.ts', {
    '../middlewares/errorHandler': errorHandlerMock,
  });
  let queryNumber = 0;
  await assert.rejects(
    () => periodLock.lockOpenBudgetPeriod(
      {
        $queryRaw: async () => {
          queryNumber += 1;
          return queryNumber === 1 ? [{ pg_advisory_xact_lock: null }] : [{ id: 9 }];
        },
      },
      'FUEL',
      2026,
      7,
    ),
    (error) => error.statusCode === 409 && /periodo presupuestal está cerrado/.test(error.message),
  );

  const validator = loadTypeScriptModule('src/validators/budgetValidator.ts', {});
  assert.equal(
    validator.distributeBudgetSchema.safeParse({
      kind: 'FUEL', year: 2026, month: 7,
      distributions: [{ vehicleId: 1, baseAmount: 0.009 }],
    }).success,
    false,
    'La ruta heredada debe rechazar sub-centavos antes de llegar a Prisma',
  );

  const budgetRouter = fs.readFileSync(path.join(apiRoot, 'src/routes/budgetRouter.ts'), 'utf8');
  assert.match(budgetRouter, /requestedCents\s*<\s*assignedCents/);
  assert.match(budgetRouter, /lockOpenBudgetPeriod\(tx, kind, year, month\)/);

  const distributionService = fs.readFileSync(
    path.join(apiRoot, 'src/services/budgetDistributionService.ts'),
    'utf8',
  );
  assert.match(distributionService, /distributeExplicitBudgets/);
  assert.match(distributionService, /lockExplicitActiveVehicleIds/);
  assert.match(distributionService, /validateReplacementAgainstSpent/);
  assert.match(distributionService, /upsertBudgetAllocationsInBatches/);
  assert.match(distributionService, /"isCutOff" = EXCLUDED\."isCutOff"/);

  const closeService = fs.readFileSync(
    path.join(apiRoot, 'src/services/budgetService.ts'),
    'utf8',
  );
  assert.match(closeService, /lockBudgetTimelineExclusive/);
  assert.match(closeService, /monthlyBudget\.findMany/);
  assert.match(closeService, /monthlyBudget\.upsert/);
  assert.match(closeService, /Solo se pueden cerrar periodos anteriores/);

  const closureMigration = fs.readFileSync(
    path.join(
      apiRoot,
      'prisma/migrations/20260715020000_budget_period_closure/migration.sql',
    ),
    'utf8',
  );
  assert.match(closureMigration, /ADD COLUMN "isClosed" BOOLEAN NOT NULL DEFAULT false/);

  const ticketBudget = fs.readFileSync(
    path.join(apiRoot, 'src/services/tickets/shared.ts'),
    'utf8',
  );
  assert.ok(
    ticketBudget.indexOf('await lockBudgetTimelineShared') < ticketBudget.indexOf('FROM vehicles'),
    'La reserva de tickets debe entrar al timeline antes de bloquear el vehículo',
  );
}

async function main() {
  await testVehicleConcurrencyAndSoftDelete();
  await testAuthoritativeMassDistribution();
  await testOperationalWritesRespectSoftDeleteAndOdometerLock();
  await testClosedPeriodAndPoolContracts();

  const vehicleRouter = fs.readFileSync(path.join(apiRoot, 'src/routes/vehicleRouter.ts'), 'utf8');
  assert.match(vehicleRouter, /vehicleUpdateSchema/);
  assert.match(
    vehicleRouter,
    /'\/:id\/odometer-correction'[\s\S]*?roleMiddleware\(\['ADMIN'\]\)/,
    'La corrección de odómetro debe quedar restringida a ADMIN',
  );

  const budgetUi = fs.readFileSync(
    path.join(apiRoot, '..', 'web/src/components/budget/BudgetTable.tsx'),
    'utf8',
  );
  assert.doesNotMatch(budgetUi, /\bas any\b|no-explicit-any/);
  assert.doesNotMatch(budgetUi, /useVehicles|limit:\s*500/);
  for (const mode of ['ALL', 'UNASSIGNED', 'CLASSIFICATION']) {
    assert.ok(budgetUi.includes(`'${mode}'`), `La UI debe exponer el criterio ${mode}`);
  }

  const odometerUi = fs.readFileSync(
    path.join(apiRoot, '..', 'web/src/components/vehicles/OdometerCorrectionDialog.tsx'),
    'utf8',
  );
  const vehicleHooks = fs.readFileSync(
    path.join(apiRoot, '..', 'web/src/hooks/useVehicles.ts'),
    'utf8',
  );
  assert.match(vehicleHooks, /odometer-correction/);
  assert.match(odometerUi, /expectedUpdatedAt:\s*vehicle\.updatedAt/);
  assert.match(odometerUi, /reason\.length\s*<\s*10/);
  assert.match(odometerUi, /apiError\.status\s*===\s*409/);

  console.log('Sprint 2 vehicle and budget behavior checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

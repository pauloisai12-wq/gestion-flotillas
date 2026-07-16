const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const apiRoot = path.resolve(__dirname, '..');
const servicePath = path.join(apiRoot, 'src', 'services', 'fuelLoadService.ts');

class TestAppError extends Error {
  constructor(statusCode, message, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function appError(status, code) {
  return (message, details) => new TestAppError(status, message, code, details);
}

function loadService(prismaMock, budgetMocks) {
  const source = fs.readFileSync(servicePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: servicePath,
  }).outputText;

  const testModule = { exports: {} };
  function testRequire(request) {
    if (request === '../lib/prisma') return { __esModule: true, default: prismaMock };
    if (request === './budgetService') return budgetMocks;
    if (request === '../lib/businessTime') {
      return { businessPeriodForDate: budgetMocks.budgetPeriodForDate };
    }
    if (request === './budgetPeriodLock') {
      return {
        lockBudgetPeriod: budgetMocks.lockBudgetPeriod || (async () => {}),
        lockBudgetTimelineShared: budgetMocks.lockBudgetTimelineShared || (async () => {}),
      };
    }
    if (request === '../middlewares/errorHandler') {
      return {
        AppError: TestAppError,
        BadRequest: appError(400, 'BAD_REQUEST'),
        Conflict: appError(409, 'CONFLICT'),
        NotFound: (entity) => new TestAppError(404, `${entity} no encontrado`, 'NOT_FOUND'),
      };
    }
    throw new Error(`Dependencia no simulada: ${request}`);
  }

  const factory = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled);
  factory(testModule.exports, testRequire, testModule, servicePath, path.dirname(servicePath));
  return testModule.exports;
}

function basePending(overrides = {}) {
  return {
    id: 41,
    vehicleId: 7,
    stationId: 3,
    operatorId: 11,
    amount: 150,
    liters: 10,
    odometer: 120,
    odometerStatus: 'OK',
    kmPerLiter: null,
    status: 'PENDING_REVIEW',
    loadDate: new Date('2026-07-15T12:00:00Z'),
    reviewedAt: null,
    reviewedById: null,
    reviewReason: null,
    requiresReconciliation: false,
    vehicle: { id: 7, economicNumber: 'ECO-007', plate: 'ABC-123' },
    station: { id: 3, legalName: 'Estación', tradeName: null, isActive: true },
    operator: { id: 11, fullName: 'Operador', employeeNumber: 'EMP-11' },
    reviewedBy: null,
    ...overrides,
  };
}

function queryText(strings) {
  return Array.isArray(strings) ? strings.join(' ') : String(strings);
}

async function testReviewIsExactlyOnce() {
  let state = { status: 'PENDING_REVIEW', requiresReconciliation: false };
  let current = basePending();
  let reserveCalls = 0;
  let vehicleUpdates = 0;
  let loadUpdates = 0;
  let auditWrites = 0;

  const tx = {
    $queryRaw: async (strings) => {
      const sql = queryText(strings);
      if (sql.includes('FROM fuel_loads')) return [{ id: 41, ...state }];
      if (sql.includes('FROM vehicles')) {
        return [{ id: 7, currentOdometer: 100, status: 'OPERATIVE', isActive: true, blockReason: null }];
      }
      return [{ id: 3 }];
    },
    approvedStation: { findUnique: async () => ({ id: 3, isActive: true }) },
    fuelLoad: {
      findUnique: async () => current,
      findFirst: async ({ where }) => (
        where.status === 'PENDING_REVIEW' ? null : { odometer: 100 }
      ),
      update: async ({ data }) => {
        loadUpdates += 1;
        state = { status: data.status, requiresReconciliation: false };
        current = { ...current, ...data, reviewedAt: data.reviewedAt, reviewedBy: { id: 9, fullName: 'Revisor' } };
        return current;
      },
    },
    vehicle: { update: async () => { vehicleUpdates += 1; } },
    auditLog: { create: async () => { auditWrites += 1; } },
  };
  const service = loadService(
    { $transaction: async () => { throw new Error('Use el núcleo inyectable'); } },
    {
      budgetPeriodForDate: () => ({ year: 2026, month: 7 }),
      checkAndReserveFuelBudget: async () => {
        reserveCalls += 1;
        return { allowed: true, available: 850 };
      },
      releaseFuelBudget: async () => { throw new Error('No debe liberar al aprobar'); },
    },
  );

  const first = await service.reviewFuelLoadInTransaction(
    tx,
    41,
    { decision: 'APPROVE', reason: 'Comprobante validado' },
    9,
  );
  const retry = await service.reviewFuelLoadInTransaction(
    tx,
    41,
    { decision: 'APPROVE', reason: 'Reintento del cliente' },
    9,
  );

  assert.equal(first.status, 'APPROVED');
  assert.equal(first.idempotent, false);
  assert.equal(first.kmPerLiter, 2);
  assert.equal(retry.idempotent, true);
  assert.equal(reserveCalls, 1, 'Un reintento no debe volver a descontar presupuesto');
  assert.equal(vehicleUpdates, 1, 'Un reintento no debe volver a aplicar odómetro');
  assert.equal(loadUpdates, 1, 'La transición solo debe persistirse una vez');
  assert.equal(auditWrites, 1, 'La decisión efectiva debe tener una sola auditoría explícita');
}

async function testRejectHasNoEffectsAndLegacyIsBlocked() {
  let current = basePending();
  let vehicleReads = 0;
  let budgetCalls = 0;
  const tx = {
    $queryRaw: async (strings) => {
      const sql = queryText(strings);
      if (sql.includes('FROM fuel_loads')) {
        return [{ id: 41, status: current.status, requiresReconciliation: current.requiresReconciliation }];
      }
      vehicleReads += 1;
      throw new Error('Un rechazo no debe bloquear ni mutar el vehículo');
    },
    fuelLoad: {
      findUnique: async () => current,
      update: async ({ data }) => {
        current = { ...current, ...data };
        return current;
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const service = loadService(
    {},
    {
      budgetPeriodForDate: () => ({ year: 2026, month: 7 }),
      checkAndReserveFuelBudget: async () => { budgetCalls += 1; },
      releaseFuelBudget: async () => { budgetCalls += 1; },
    },
  );

  const rejected = await service.reviewFuelLoadInTransaction(
    tx,
    41,
    { decision: 'REJECT', reason: 'Importe no comprobado' },
    9,
  );
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(vehicleReads, 0);
  assert.equal(budgetCalls, 0);

  current = basePending({ requiresReconciliation: true });
  await assert.rejects(
    () => service.reviewFuelLoadInTransaction(
      tx,
      41,
      { decision: 'APPROVE', reason: 'No debe inferirse' },
      9,
    ),
    (error) => error.code === 'RECONCILIATION_REQUIRED',
  );
  assert.equal(budgetCalls, 0, 'Un pendiente histórico no debe recibir efectos por la ruta normal');
}

async function testApprovalRequiresChronologicalOrder() {
  const current = basePending();
  let vehicleReads = 0;
  let budgetCalls = 0;
  const tx = {
    $queryRaw: async (strings) => {
      const sql = queryText(strings);
      if (sql.includes('FROM fuel_loads')) {
        return [{ id: current.id, status: current.status, requiresReconciliation: false }];
      }
      if (sql.includes('FROM vehicles')) vehicleReads += 1;
      throw new Error(`Query no esperada: ${sql}`);
    },
    fuelLoad: {
      findUnique: async () => current,
      findFirst: async ({ where }) => (
        where.status === 'PENDING_REVIEW'
          ? { id: 40, loadDate: new Date('2026-07-15T11:00:00Z') }
          : null
      ),
    },
  };
  const service = loadService({}, {
    budgetPeriodForDate: () => ({ year: 2026, month: 7 }),
    checkAndReserveFuelBudget: async () => { budgetCalls += 1; },
    releaseFuelBudget: async () => {},
  });

  await assert.rejects(
    () => service.reviewFuelLoadInTransaction(
      tx,
      current.id,
      { decision: 'APPROVE', reason: 'Comprobante correcto' },
      9,
    ),
    (error) => error.code === 'EARLIER_FUEL_LOAD_PENDING' &&
      error.details.blockingFuelLoadId === 40,
  );
  assert.equal(vehicleReads, 0, 'El bloqueo cronológico debe ocurrir antes del vehículo');
  assert.equal(budgetCalls, 0, 'La carga posterior no debe consumir presupuesto');
}

async function testLegacyRejectCorrectsOdometerAtomically() {
  let current = basePending({ requiresReconciliation: true });
  let vehicleOdometer = 120;
  let vehicleUpdates = 0;
  const auditEntries = [];

  const tx = {
    $queryRaw: async (strings) => {
      const sql = queryText(strings);
      if (sql.includes('FROM fuel_loads')) {
        return [{ id: current.id, status: current.status, requiresReconciliation: current.requiresReconciliation }];
      }
      if (sql.includes('FROM vehicles')) {
        return [{
          id: current.vehicleId,
          currentOdometer: vehicleOdometer,
          status: 'OPERATIVE',
          isActive: true,
          blockReason: null,
        }];
      }
      throw new Error(`Query inesperada: ${sql}`);
    },
    vehicleBudget: { findUnique: async () => null },
    fuelLoad: {
      findUnique: async () => current,
      aggregate: async () => ({ _max: { odometer: 90 } }),
      update: async ({ data }) => {
        current = { ...current, ...data, reviewedBy: { id: 9, fullName: 'Admin' } };
        return current;
      },
    },
    maintenanceRecord: {
      aggregate: async () => ({ _max: { odometer: 95 } }),
    },
    vehicle: {
      update: async ({ data }) => {
        vehicleUpdates += 1;
        vehicleOdometer = data.currentOdometer;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        auditEntries.push(data);
      },
    },
  };
  const service = loadService(
    {},
    {
      budgetPeriodForDate: () => ({ year: 2026, month: 7 }),
      checkAndReserveFuelBudget: async () => { throw new Error('No debe reservar al rechazar'); },
      releaseFuelBudget: async () => { throw new Error('NO_BUDGET no debe liberar'); },
    },
  );

  await assert.rejects(
    () => service.reconcileLegacyFuelLoadInTransaction(
      tx,
      41,
      {
        decision: 'REJECT',
        reason: 'Captura historica invalida',
        budgetEffect: 'NO_BUDGET',
        odometerEffect: 'APPLIED',
      },
      9,
    ),
    /corregido es obligatorio/i,
  );
  assert.equal(vehicleUpdates, 0);
  assert.equal(current.status, 'PENDING_REVIEW');

  await assert.rejects(
    () => service.reconcileLegacyFuelLoadInTransaction(
      tx,
      41,
      {
        decision: 'REJECT',
        reason: 'Captura historica invalida',
        budgetEffect: 'NO_BUDGET',
        odometerEffect: 'APPLIED',
        correctedOdometer: 80,
      },
      9,
    ),
    /lectura aprobada/i,
  );
  assert.equal(vehicleUpdates, 0);

  const result = await service.reconcileLegacyFuelLoadInTransaction(
    tx,
    41,
    {
      decision: 'REJECT',
      reason: 'Captura historica invalida',
      budgetEffect: 'NO_BUDGET',
      odometerEffect: 'APPLIED',
      correctedOdometer: 100,
    },
    9,
  );

  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(result.odometerCorrection, { before: 120, after: 100, evidenceFloor: 95 });
  assert.equal(vehicleOdometer, 100);
  assert.equal(vehicleUpdates, 1);
  assert.equal(current.requiresReconciliation, false);
  assert.equal(auditEntries.filter((entry) => entry.action === 'ODOMETER_CORRECTION').length, 1);
  assert.equal(auditEntries.filter((entry) => entry.action === 'FUEL_LOAD_RECONCILE').length, 1);
}

async function testConcurrentOdometerIsMonotonic() {
  let currentOdometer = 80;
  let releaseLock = null;
  let lockTail = Promise.resolve();
  const inserted = [];
  let reserveCalls = 0;

  function makeTx() {
    return {
      $queryRaw: async (strings) => {
        const sql = queryText(strings);
        if (!sql.includes('FROM vehicles')) return [{ id: 3 }];
        const previous = lockTail;
        let unlock;
        lockTail = new Promise((resolve) => { unlock = resolve; });
        await previous;
        releaseLock = unlock;
        return [{ id: 7, currentOdometer, status: 'OPERATIVE', isActive: true, blockReason: null }];
      },
      approvedStation: { findUnique: async () => ({ id: 3, isActive: true }) },
      operator: { findUnique: async () => ({ id: 11 }) },
      fuelLoad: {
        findFirst: async () => null,
        create: async ({ data }) => {
          inserted.push(data.odometer);
          return { id: inserted.length, ...data, amount: Number(data.amount) };
        },
      },
      vehicle: {
        update: async ({ data }) => { currentOdometer = data.currentOdometer; },
      },
    };
  }

  const service = loadService(
    {},
    {
      budgetPeriodForDate: () => ({ year: 2026, month: 7 }),
      checkAndReserveFuelBudget: async () => {
        reserveCalls += 1;
        return { allowed: true, available: 1000 };
      },
      releaseFuelBudget: async () => ({}),
    },
  );

  async function run(odometer) {
    try {
      return await service.createFuelLoadInTransaction(makeTx(), {
        vehicleId: 7,
        operatorEmployee: 'EMP-11',
        operatorName: 'Operador',
        stationId: 3,
        liters: 10,
        amount: 100,
        odometer,
        odometerStatus: 'OK',
      });
    } finally {
      if (releaseLock) {
        const unlock = releaseLock;
        releaseLock = null;
        unlock();
      }
    }
  }

  const high = run(120);
  await new Promise((resolve) => setImmediate(resolve));
  const low = run(110);
  const results = await Promise.allSettled([high, low]);

  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.statusCode, 409);
  assert.deepEqual(inserted, [120], 'La lectura regresiva no debe insertarse en el historial');
  assert.equal(currentOdometer, 120);
  assert.equal(reserveCalls, 1, 'La lectura rechazada no debe consumir presupuesto');
}

function testOdometerCorrectionContract() {
  const validator = fs.readFileSync(path.join(apiRoot, 'src', 'validators', 'vehicleValidator.ts'), 'utf8');
  const router = fs.readFileSync(path.join(apiRoot, 'src', 'routes', 'vehicleRouter.ts'), 'utf8');
  const service = fs.readFileSync(path.join(apiRoot, 'src', 'services', 'vehicleService.ts'), 'utf8');

  assert.match(validator, /omit\(\{[^}]*currentOdometer:\s*true/, 'PUT ordinario debe omitir odómetro');
  assert.ok(router.includes("'/:id/odometer-correction'"), 'Debe existir una operación separada de corrección');
  assert.ok(
    router.includes('RoleGroups.ADMIN_ONLY') || router.includes("roleMiddleware(['ADMIN'])"),
    'La corrección debe ser exclusivamente ADMIN',
  );
  assert.ok(service.includes('ODOMETER_CORRECTION'), 'La corrección debe escribir auditoría explícita');
  assert.ok(service.includes('expectedUpdatedAt'), 'La corrección debe detectar ediciones concurrentes');
}

function testFuelBudgetLockOrderContract() {
  const service = fs.readFileSync(servicePath, 'utf8');
  const createScope = service.slice(
    service.indexOf('export async function createFuelLoadInTransaction'),
    service.indexOf('async function requireActiveAssignedOperator'),
  );
  assert.ok(
    createScope.indexOf('lockBudgetPeriod') >= 0 &&
      createScope.indexOf('lockVehicleForFuel') >= 0 &&
      createScope.indexOf('lockBudgetPeriod') < createScope.indexOf('lockVehicleForFuel'),
    'Alta autenticada debe bloquear periodo antes que vehiculo',
  );

  const reviewScope = service.slice(
    service.indexOf('export async function reviewFuelLoadInTransaction'),
    service.indexOf('async function assertBudgetEffectClaim'),
  );
  assert.ok(
    reviewScope.indexOf('lockBudgetPeriod') >= 0 &&
      reviewScope.indexOf('requireVehicleEligibleForApproval') >= 0 &&
      reviewScope.indexOf('lockBudgetPeriod') < reviewScope.indexOf('requireVehicleEligibleForApproval'),
    'Aprobacion debe bloquear periodo antes que vehiculo',
  );

  const reconciliationScope = service.slice(
    service.indexOf('export async function reconcileLegacyFuelLoadInTransaction'),
  );
  assert.ok(
    reconciliationScope.indexOf('lockBudgetPeriod') >= 0 &&
      reconciliationScope.indexOf('requireVehicleEligibleForApproval') >= 0 &&
      reconciliationScope.indexOf('lockBudgetPeriod') <
      reconciliationScope.indexOf('requireVehicleEligibleForApproval'),
    'Reconciliacion debe bloquear periodo antes que vehiculo',
  );
  assert.ok(
    reconciliationScope.indexOf('lockBudgetPeriod') >= 0 &&
      reconciliationScope.indexOf('releaseFuelBudget') >= 0 &&
      reconciliationScope.indexOf('lockBudgetPeriod') < reconciliationScope.indexOf('releaseFuelBudget'),
    'Reconciliacion debe bloquear periodo antes de compensar presupuesto',
  );
}

function testReviewRbacAndSafeMigration() {
  const router = fs.readFileSync(path.join(apiRoot, 'src', 'routes', 'fuelLoadRouter.ts'), 'utf8');
  const migration = fs.readFileSync(
    path.join(
      apiRoot,
      'prisma',
      'migrations',
      '20260715010000_fuel_review_state',
      'migration.sql',
    ),
    'utf8',
  );

  const reviewRoute = router.slice(router.indexOf("'/:id/review'"), router.indexOf("'/:id/reconcile'"));
  const reconcileRoute = router.slice(router.indexOf("'/:id/reconcile'"), router.indexOf('router.post('));
  assert.ok(reviewRoute.includes('RoleGroups.FUEL_MANAGERS'), 'Solo responsables de combustible revisan');
  assert.ok(reconcileRoute.includes('RoleGroups.ADMIN_ONLY'), 'Solo ADMIN reconcilia históricos');

  assert.ok(migration.includes('SET "requiresReconciliation" = true'));
  assert.ok(migration.includes("WHERE \"status\" = 'PENDING_REVIEW'"));
  assert.ok(
    migration.includes('DEFAULT true'),
    'El default fail-safe debe identificar escrituras de una API vieja durante el despliegue',
  );
  assert.ok(
    migration.includes('SET "requiresReconciliation" = false') && migration.includes('WHERE "status" <>'),
    'Solo los estados no pendientes heredados se normalizan a false',
  );
  assert.ok(!migration.includes('UPDATE "vehicle_budgets"'), 'La migración no debe adivinar efectos financieros');
  assert.ok(!migration.includes('UPDATE "vehicles"'), 'La migración no debe adivinar efectos de odómetro');
  assert.ok(!migration.includes('SET "status"'), 'La migración no debe decidir cargas históricas');
}

async function main() {
  await testReviewIsExactlyOnce();
  await testRejectHasNoEffectsAndLegacyIsBlocked();
  await testApprovalRequiresChronologicalOrder();
  await testLegacyRejectCorrectsOdometerAtomically();
  await testConcurrentOdometerIsMonotonic();
  testOdometerCorrectionContract();
  testFuelBudgetLockOrderContract();
  testReviewRbacAndSafeMigration();
  console.log('Sprint 2 fuel integrity behavior checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

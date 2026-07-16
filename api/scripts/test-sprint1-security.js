const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(apiRoot, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `No se encontró el inicio de sección: ${start}`);
  assert.notEqual(endIndex, -1, `No se encontró el fin de sección: ${end}`);
  return source.slice(startIndex, endIndex);
}

function roleGroupMembers(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*\\[([^\\]]+)\\]`));
  assert.ok(match, `No se encontró RoleGroups.${name}`);
  return [...match[1].matchAll(/Roles\.([A-Z_]+)/g)].map((item) => item[1]);
}

const roleMiddleware = read('src/middlewares/roleMiddleware.ts');
assert.deepEqual(
  roleGroupMembers(roleMiddleware, 'MAINTENANCE_READERS'),
  ['ADMIN', 'SUP_VEHICLES', 'SUP_MAINT'],
  'MAINTENANCE_READERS debe denegar por defecto a combustible, ejecutor, taller y revisor',
);
assert.deepEqual(
  roleGroupMembers(roleMiddleware, 'BUDGET_READERS'),
  ['ADMIN', 'SUP_FUEL', 'SUP_MAINT'],
  'BUDGET_READERS debe denegar por defecto a vehículos, ejecutor, taller y revisor',
);

// Exercise the real middleware for every Prisma role. The source-level route
// checks below ensure the protected endpoints are wired to these exact groups.
function loadRoleModule() {
  const filename = path.join(apiRoot, 'src/middlewares/roleMiddleware.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const testModule = { exports: {} };
  const factory = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled);
  factory(
    testModule.exports,
    (request) => {
      throw new Error(`Unexpected RBAC dependency: ${request}`);
    },
    testModule,
    filename,
    path.dirname(filename),
  );
  return testModule.exports;
}

function exerciseRoleMatrix(middlewareFactory, allowedRoles, allRoles) {
  for (const role of allRoles) {
    let statusCode;
    let nextCalled = false;
    const req = { user: { userId: 1, email: 'test@example.invalid', role } };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
    middlewareFactory(allowedRoles)(req, res, () => {
      nextCalled = true;
    });

    if (allowedRoles.includes(role)) {
      assert.equal(nextCalled, true, `${role} should be allowed`);
      assert.equal(statusCode, undefined, `${role} should not receive an HTTP error`);
    } else {
      assert.equal(nextCalled, false, `${role} should be denied`);
      assert.equal(statusCode, 403, `${role} should receive HTTP 403`);
    }
  }
}

const runtimeRoleModule = loadRoleModule();
const runtimeRoles = runtimeRoleModule.Roles;
const runtimeGroups = runtimeRoleModule.RoleGroups;
const allRuntimeRoles = Object.values(runtimeRoles);
exerciseRoleMatrix(
  runtimeRoleModule.roleMiddleware,
  runtimeGroups.MAINTENANCE_READERS,
  allRuntimeRoles,
);
exerciseRoleMatrix(
  runtimeRoleModule.roleMiddleware,
  runtimeGroups.BUDGET_READERS,
  allRuntimeRoles,
);

let unauthenticatedStatus;
runtimeRoleModule.roleMiddleware(runtimeGroups.MAINTENANCE_READERS)(
  {},
  {
    status(code) {
      unauthenticatedStatus = code;
      return this;
    },
    json() {
      return this;
    },
  },
  () => assert.fail('Unauthenticated request passed RBAC'),
);
assert.equal(unauthenticatedStatus, 401);

const maintenanceRouter = read('src/routes/maintenanceRouter.ts');
for (const signature of [
  "router.get('/pending', roleMiddleware(RoleGroups.MAINTENANCE_READERS)",
  "router.get('/upcoming/:vehicleId', roleMiddleware(RoleGroups.MAINTENANCE_READERS)",
  "router.get('/', roleMiddleware(RoleGroups.MAINTENANCE_READERS)",
  "router.get('/vehicle/:vehicleId', roleMiddleware(RoleGroups.MAINTENANCE_READERS)",
]) {
  assert.ok(maintenanceRouter.includes(signature), `Falta RBAC explícito: ${signature}`);
}

const budgetRouter = read('src/routes/budgetRouter.ts');
assert.ok(
  budgetRouter.includes("router.get('/', requireRole(RoleGroups.BUDGET_READERS)"),
  'GET /budgets debe usar BUDGET_READERS',
);
assert.ok(
  budgetRouter.includes("router.get('/monthly-pool', requireRole(RoleGroups.BUDGET_READERS)"),
  'GET /budgets/monthly-pool debe usar BUDGET_READERS',
);

const apiIndex = read('src/index.ts');
assert.ok(
  apiIndex.includes("uploadCategory === 'maintenance'") &&
    apiIndex.includes('RoleGroups.MAINTENANCE_READERS'),
  'Las evidencias estáticas de mantenimiento deben usar MAINTENANCE_READERS',
);
assert.ok(
  apiIndex.includes("uploadCategory === 'documents'") &&
    apiIndex.includes('RoleGroups.VEHICLE_READERS'),
  'Los documentos estáticos deben usar VEHICLE_READERS',
);
assert.ok(
  apiIndex.includes('decodeURIComponent(req.path)') && apiIndex.includes('path.posix.normalize'),
  'La categoría de upload debe normalizarse antes del control de rol',
);

const fuelLoadService = read('src/services/fuelLoadService.ts');
const authenticatedCreate = section(
  fuelLoadService,
  'export async function createFuelLoad',
  'async function requireActiveAssignedOperator',
);
assert.ok(
  authenticatedCreate.includes("if (!station.isActive) throw BadRequest('Gasolinera inactiva')"),
  'El alta autenticada debe rechazar gasolineras inactivas',
);
const previousLoadLookup = section(authenticatedCreate, 'const prev =', 'if (prev &&');
assert.ok(
  previousLoadLookup.includes("status: 'APPROVED'"),
  'El km/l de una carga autenticada no debe tomar una captura pendiente como carga previa',
);

const assignmentGuard = section(
  fuelLoadService,
  'async function requireActiveAssignedOperator',
  '/** Validación compartida por GET /public/verify. */',
);
assert.ok(assignmentGuard.includes('startDate: { lte: now }'), 'Debe validar el inicio de asignación');
assert.ok(assignmentGuard.includes('{ endDate: null }'), 'Debe aceptar solo asignaciones no terminadas o vigentes');
assert.ok(
  assignmentGuard.includes('operator: { is: { employeeNumber, isActive: true } }'),
  'Debe exigir operador existente y activo',
);

const publicCreate = section(
  fuelLoadService,
  'export async function createPublicFuelLoad',
  'export async function getVehicleMovingAverage',
);
assert.ok(
  publicCreate.includes('return prisma.$transaction((tx) => createPublicFuelLoadInTransaction(tx, data))'),
  'El entry point público debe delegar todo el alta a una transacción',
);
assert.ok(publicCreate.includes("status: 'PENDING_REVIEW'"), 'La carga pública debe quedar pendiente');
assert.ok(publicCreate.includes('operatorId: operator.id'), 'La carga pública debe vincular operador válido');
assert.ok(
  publicCreate.includes("if (!station.isActive) throw BadRequest('Gasolinera inactiva')"),
  'La carga pública debe rechazar gasolineras inactivas',
);
assert.ok(
  publicCreate.includes('requireActiveAssignedOperator('),
  'La carga pública debe validar la asignación operador–vehículo',
);
assert.ok(!publicCreate.includes('checkAndReserveFuelBudget'), 'La carga pública no debe reservar presupuesto');
assert.ok(!publicCreate.includes('tx.vehicle.update'), 'La carga pública no debe actualizar el odómetro');

const publicRouter = read('src/routes/publicRouter.ts');
const verifyRoute = section(publicRouter, "router.get('/verify'", "router.post('/fuel-loads'");
assert.ok(
  verifyRoute.includes('getActiveAssignedPublicOperator('),
  'GET /public/verify debe validar la asignación operador–vehículo',
);
assert.ok(!verifyRoute.includes('prisma.operator.findUnique'), 'GET /public/verify no debe aceptar operador opcional');

const movingAverage = fuelLoadService.slice(
  fuelLoadService.indexOf('export async function getVehicleMovingAverage'),
);
assert.ok(
  movingAverage.includes("status: 'APPROVED'"),
  'El promedio móvil debe ignorar cargas pendientes o rechazadas',
);

// Las capturas PENDING_REVIEW nunca deben alimentar métricas operativas. Se
// cubren por separado los fallbacks con filtros, las vistas sin filtros y las
// cuatro consultas reutilizadas por PDF/Excel.
const dashboardService = read('src/services/dashboardService.ts');
const dashboardSummary = section(
  dashboardService,
  'export async function getDashboardSummary',
  'export async function getFuelMonthlyTrend',
);
assert.ok(
  dashboardSummary.includes("status: 'APPROVED'"),
  'El resumen filtrado debe agregar solo cargas APPROVED',
);

for (const [label, start, end] of [
  ['tendencia mensual filtrada', 'export async function getFuelMonthlyTrend', 'export async function getVehicleRankingTop'],
  ['ranking de operadores filtrado', 'export async function getOperatorRanking', 'export async function getBudgetProgress'],
  ['ranking de vehículos filtrado', 'async function queryVehicleRanking', null],
]) {
  const source = end ? section(dashboardService, start, end) : dashboardService.slice(dashboardService.indexOf(start));
  assert.ok(
    source.includes(`fl.status = 'APPROVED'::"FuelLoadStatus"`),
    `${label} debe agregar solo cargas APPROVED`,
  );
  assert.ok(!source.includes('PENDING_REVIEW'), `${label} no debe aceptar PENDING_REVIEW`);
}

const aggregateMigration = read(
  'prisma/migrations/20260715000000_exclude_pending_fuel_from_aggregates/migration.sql',
);
const viewSections = [
  ['mv_dashboard_summary', 'CREATE MATERIALIZED VIEW mv_dashboard_summary', 'CREATE MATERIALIZED VIEW mv_fuel_monthly_trend', 4],
  ['mv_fuel_monthly_trend', 'CREATE MATERIALIZED VIEW mv_fuel_monthly_trend', 'CREATE MATERIALIZED VIEW mv_vehicle_ranking', 1],
  ['mv_vehicle_ranking', 'CREATE MATERIALIZED VIEW mv_vehicle_ranking', 'CREATE MATERIALIZED VIEW mv_operator_ranking', 1],
  ['mv_operator_ranking', 'CREATE MATERIALIZED VIEW mv_operator_ranking', '-- Requeridos por REFRESH', 1],
];
for (const [name, start, end, expectedFilters] of viewSections) {
  const source = section(aggregateMigration, start, end);
  const filters = source.match(/fl\.status = 'APPROVED'::"FuelLoadStatus"/g) || [];
  assert.equal(
    filters.length,
    expectedFilters,
    `${name} debe filtrar APPROVED en cada agregado de combustible`,
  );
  assert.ok(!source.includes('PENDING_REVIEW'), `${name} no debe agregar PENDING_REVIEW`);
}

const reportQueries = readRepo('worker/generate_pdf.py');
for (const [name, start, end] of [
  ['get_summary', 'def get_summary', 'def get_fuel_by_type'],
  ['get_fuel_by_type', 'def get_fuel_by_type', 'def get_top_consumers'],
  ['get_top_consumers', 'def get_top_consumers', 'def get_kml_ranking'],
  ['get_kml_ranking', 'def get_kml_ranking', 'def get_docs_summary'],
]) {
  const source = section(reportQueries, start, end);
  assert.ok(
    source.includes(`status = 'APPROVED'::"FuelLoadStatus"`),
    `${name} debe incluir solo cargas APPROVED en PDF/Excel`,
  );
  assert.ok(!source.includes('PENDING_REVIEW'), `${name} no debe incluir PENDING_REVIEW`);
}

const fuelValidatorFile = path.join(apiRoot, 'src/validators/fuelLoadValidator.ts');
const compiledFuelValidator = ts.transpileModule(fs.readFileSync(fuelValidatorFile, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: fuelValidatorFile,
}).outputText;
const fuelValidatorModule = { exports: {} };
new Function('exports', 'require', 'module', '__filename', '__dirname', compiledFuelValidator)(
  fuelValidatorModule.exports,
  require,
  fuelValidatorModule,
  fuelValidatorFile,
  path.dirname(fuelValidatorFile),
);
const fuelValidators = fuelValidatorModule.exports;
const validFuelLoad = {
  vehicleId: 1,
  operatorEmployee: 'EMP-001',
  operatorName: 'Operador',
  stationId: 1,
  amount: fuelValidators.MAX_FUEL_LOAD_AMOUNT,
  odometer: 1,
  odometerStatus: 'OK',
};
assert.equal(fuelValidators.fuelLoadSchema.safeParse(validFuelLoad).success, true);
assert.equal(
  fuelValidators.fuelLoadSchema.safeParse({
    ...validFuelLoad,
    amount: fuelValidators.MAX_FUEL_LOAD_AMOUNT + 0.01,
  }).success,
  false,
  'El monto debe rechazarse antes de exceder NUMERIC(12,2)',
);
const { vehicleId: _vehicleId, ...publicFuelFields } = validFuelLoad;
const validPublicFuelLoad = {
  ...publicFuelFields,
  vehicleEconomicNumber: 'ECO-001',
  csrfToken: 'csrf-token-valido',
};
assert.equal(fuelValidators.publicFuelLoadSchema.safeParse(validPublicFuelLoad).success, true);
assert.equal(
  fuelValidators.publicFuelLoadSchema.safeParse({
    ...validPublicFuelLoad,
    amount: fuelValidators.MAX_FUEL_LOAD_AMOUNT + 0.01,
  }).success,
  false,
  'El portal público también debe rechazar montos fuera de NUMERIC(12,2)',
);

console.log('Sprint 1 security regression checks passed');

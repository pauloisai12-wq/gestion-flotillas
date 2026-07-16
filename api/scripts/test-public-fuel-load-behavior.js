const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const servicePath = path.resolve(__dirname, '..', 'src', 'services', 'fuelLoadService.ts');

class TestAppError extends Error {
  constructor(statusCode, message, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function loadFuelLoadService(prismaMock, reserveBudgetMock) {
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
    if (request === '../lib/prisma') {
      return { __esModule: true, default: prismaMock };
    }
    if (request === './budgetService') {
      return { checkAndReserveFuelBudget: reserveBudgetMock };
    }
    if (request === '../lib/businessTime') {
      return { businessPeriodForDate: () => ({ year: 2026, month: 7 }) };
    }
    if (request === './budgetPeriodLock') {
      return {
        lockBudgetPeriod: async () => {},
        lockBudgetTimelineShared: async () => {},
      };
    }
    if (request === '../middlewares/errorHandler') {
      return {
        AppError: TestAppError,
        BadRequest: (message, details) => new TestAppError(400, message, 'BAD_REQUEST', details),
        NotFound: (entity) => new TestAppError(404, `${entity} no encontrado`, 'NOT_FOUND'),
      };
    }
    throw new Error(`Dependencia no simulada: ${request}`);
  }

  // Ejecuta únicamente este módulo con sus tres dependencias sustituidas por mocks.
  // No abre conexión a PostgreSQL ni carga el cliente Prisma real.
  const factory = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled);
  factory(testModule.exports, testRequire, testModule, servicePath, path.dirname(servicePath));
  return testModule.exports;
}

async function main() {
  let reserveCalls = 0;
  let vehicleMutationCalls = 0;
  let fuelCreateCalls = 0;
  let createdData;
  let assignmentQuery;

  const forbiddenVehicleMutation = async () => {
    vehicleMutationCalls += 1;
    throw new Error('Una carga pública intentó actualizar el vehículo');
  };

  const tx = {
    vehicle: {
      findUnique: async () => ({
        id: 7,
        economicNumber: 'ECO-007',
        plate: 'ABC-123',
        isActive: true,
        status: 'ACTIVE',
        blockReason: null,
        currentOdometer: 1000,
      }),
      update: forbiddenVehicleMutation,
      updateMany: forbiddenVehicleMutation,
    },
    approvedStation: {
      findUnique: async () => ({ id: 3, isActive: true }),
    },
    vehicleAssignment: {
      findFirst: async (query) => {
        assignmentQuery = query;
        return { operator: { id: 11, fullName: 'Operador Asignado' } };
      },
    },
    vehicleBudget: {
      findUnique: async () => ({ baseAmount: 1000, rolloverIn: 100, spentAmount: 250 }),
      update: async () => {
        reserveCalls += 1;
        throw new Error('Una carga pública intentó mutar presupuesto');
      },
    },
    fuelLoad: {
      create: async ({ data }) => {
        fuelCreateCalls += 1;
        createdData = data;
        return { id: 42, status: data.status };
      },
    },
  };

  const prismaMock = {
    $transaction: async () => {
      throw new Error('La prueba conductual debe inyectar la transacción directamente');
    },
  };
  const reserveBudgetMock = async () => {
    reserveCalls += 1;
    throw new Error('Una carga pública intentó reservar presupuesto');
  };
  const service = loadFuelLoadService(prismaMock, reserveBudgetMock);

  const input = {
    csrfToken: 'test-token',
    vehicleEconomicNumber: 'ECO-007',
    operatorEmployee: 'EMP-011',
    operatorName: 'Ignorado',
    stationId: 3,
    amount: 150,
    liters: 20,
    odometerStatus: 'OK',
    odometer: 1100,
  };

  const result = await service.createPublicFuelLoadInTransaction(tx, input);

  assert.equal(reserveCalls, 0, 'No debe reservar ni mutar presupuesto');
  assert.equal(vehicleMutationCalls, 0, 'No debe actualizar odómetro/vehículo');
  assert.equal(fuelCreateCalls, 1, 'Debe crear una sola captura');
  assert.equal(createdData.status, 'PENDING_REVIEW');
  assert.equal(
    createdData.requiresReconciliation,
    false,
    'La API nueva debe distinguir explicitamente sus capturas del binario heredado',
  );
  assert.equal(createdData.operatorId, 11, 'Debe persistir el operador de la asignación vigente');
  assert.equal(createdData.vehicleId, 7);
  assert.equal(createdData.odometer, 1100, 'El odómetro se conserva solo como dato pendiente');
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(result.available, 850, 'El saldo se informa sin descontar la captura pendiente');

  assert.equal(assignmentQuery.where.vehicleId, 7);
  assert.equal(assignmentQuery.where.operator.is.employeeNumber, 'EMP-011');
  assert.equal(assignmentQuery.where.operator.is.isActive, true);
  assert.ok(assignmentQuery.where.startDate.lte instanceof Date);
  assert.ok(
    assignmentQuery.where.OR.some((condition) => condition.endDate === null),
    'Debe requerir una asignación no terminada o todavía vigente',
  );

  tx.vehicleAssignment.findFirst = async () => null;
  await assert.rejects(
    () => service.createPublicFuelLoadInTransaction(tx, input),
    /Operador inválido o sin asignación vigente/,
  );
  assert.equal(fuelCreateCalls, 1, 'Sin asignación no debe crear otra captura');
  assert.equal(reserveCalls, 0);
  assert.equal(vehicleMutationCalls, 0);

  console.log('Public fuel load behavior checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

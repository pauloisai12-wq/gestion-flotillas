// /api/src/services/fuelLoadService.ts
// Servicio v2 — cargas con odómetro NF, operador texto libre,
// reserva atómica de presupuesto con lock pesimista.

import prisma, { type Tx } from '../lib/prisma';
import {
  FuelLoadInput,
  FuelLoadReviewInput,
  LegacyFuelLoadReconciliationInput,
  PublicFuelLoadInput,
} from '../validators/fuelLoadValidator';
import {
  checkAndReserveFuelBudget,
  releaseFuelBudget,
} from './budgetService';
import { businessPeriodForDate } from '../lib/businessTime';
import {
  lockBudgetPeriod,
  lockBudgetTimelineShared,
} from './budgetPeriodLock';
import { FuelLoadStatus, OdometerStatus, Prisma } from '@prisma/client';
import { NotFound, BadRequest, AppError, Conflict } from '../middlewares/errorHandler';

interface FuelLoadQuery {
  page?: number;
  limit?: number;
  vehicleId?: number;
  operatorId?: number;
  stationId?: number;
  status?: FuelLoadStatus;
  dateFrom?: string;
  dateTo?: string;
}

export async function getAllFuelLoads(query: FuelLoadQuery) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  const where: Prisma.FuelLoadWhereInput = {};
  if (query.vehicleId) where.vehicleId = query.vehicleId;
  if (query.operatorId) where.operatorId = query.operatorId;
  if (query.stationId) where.stationId = query.stationId;
  if (query.status) where.status = query.status;
  if (query.dateFrom || query.dateTo) {
    where.loadDate = {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: new Date(query.dateTo + 'T23:59:59') } : {}),
    };
  }

  const [loads, total] = await Promise.all([
    prisma.fuelLoad.findMany({
      where, skip, take: limit,
      orderBy: query.status === 'PENDING_REVIEW'
        ? [{ loadDate: 'asc' }, { id: 'asc' }]
        : [{ loadDate: 'desc' }, { id: 'desc' }],
      include: {
        vehicle: {
          select: {
            id: true, plate: true, economicNumber: true,
            classification: true,
            vehicleType: { select: { expectedKmPerLiter: true } },
          },
        },
        operator: { select: { id: true, fullName: true, employeeNumber: true } },
        station: { select: { id: true, legalName: true, tradeName: true, isActive: true } },
      },
    }),
    prisma.fuelLoad.count({ where }),
  ]);

  const serialized = loads.map((l) => ({ ...l, amount: Number(l.amount) }));
  return { data: serialized, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getFuelLoadsByVehicle(vehicleId: number) {
  const loads = await prisma.fuelLoad.findMany({
    where: { vehicleId },
    orderBy: { loadDate: 'desc' },
    take: 50,
    include: {
      operator: { select: { fullName: true, employeeNumber: true } },
      station: { select: { legalName: true, tradeName: true } },
    },
  });
  return loads.map((l) => ({ ...l, amount: Number(l.amount) }));
}

interface LockedVehicle {
  id: number;
  currentOdometer: number;
  status: 'OPERATIVE' | 'BLOCKED';
  isActive: boolean;
  blockReason: string | null;
}

/** Bloquea la fila maestra para serializar validación, carga y odómetro. */
async function lockVehicleForFuel(tx: Tx, vehicleId: number): Promise<LockedVehicle> {
  const rows = await tx.$queryRaw<LockedVehicle[]>`
    SELECT id, "currentOdometer", status, "isActive", "blockReason"
    FROM vehicles
    WHERE id = ${vehicleId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw NotFound('Vehículo');
  return rows[0];
}

async function lockActiveStation(tx: Tx, stationId: number) {
  // FOR SHARE impide que la estación sea desactivada entre la validación y el commit.
  await tx.$queryRaw`
    SELECT id FROM approved_stations WHERE id = ${stationId} FOR SHARE
  `;
  const station = await tx.approvedStation.findUnique({ where: { id: stationId } });
  if (!station) throw new AppError(404, 'Gasolinera no encontrada', 'NOT_FOUND');
  if (!station.isActive) throw BadRequest('Gasolinera inactiva');
  return station;
}

function parseFuelLoadDate(value?: string) {
  if (!value) return new Date();
  // Mediodía en Ciudad de México evita que YYYY-MM-DD cambie de mes al
  // convertirse desde UTC (p. ej. 2026-07-01 -> 2026-06-30 18:00 local).
  const parsed = new Date(`${value}T12:00:00-06:00`);
  if (Number.isNaN(parsed.getTime())) throw BadRequest('Fecha de carga inválida');
  return parsed;
}

/** Crear carga desde el dashboard (autenticado) */
export async function createFuelLoad(data: FuelLoadInput) {
  return prisma.$transaction((tx) => createFuelLoadInTransaction(tx, data));
}

/** Núcleo transaccional exportado para pruebas conductuales de concurrencia. */
export async function createFuelLoadInTransaction(tx: Tx, data: FuelLoadInput) {
    const loadDateValue = parseFuelLoadDate(data.loadDate);
    const budgetPeriod = businessPeriodForDate(loadDateValue);
    await lockBudgetTimelineShared(tx, 'FUEL');
    await lockBudgetPeriod(tx, 'FUEL', budgetPeriod.year, budgetPeriod.month);

    const lockedVehicle = await lockVehicleForFuel(tx, data.vehicleId);
    if (!lockedVehicle.isActive) throw BadRequest('Vehículo dado de baja');
    if (lockedVehicle.status === 'BLOCKED') {
      throw BadRequest(`Vehículo bloqueado: ${lockedVehicle.blockReason ?? 'documentos vencidos'}`);
    }

    const station = await lockActiveStation(tx, data.stationId);
    // Defensa explícita en el núcleo de alta autenticada (lockActiveStation ya
    // hace la misma comprobación antes de devolver la fila).
    if (!station.isActive) throw BadRequest('Gasolinera inactiva');

    // Match de operador por employeeNumber (el contrato autenticado conserva texto libre).
    const operatorMatch = await tx.operator.findUnique({
      where: { employeeNumber: data.operatorEmployee },
    });

    if (data.odometerStatus === 'OK') {
      const odometer = data.odometer as number;
      if (odometer < lockedVehicle.currentOdometer) {
        throw Conflict(
          `El odómetro (${odometer} km) no puede ser menor al actual (${lockedVehicle.currentOdometer} km)`,
        );
      }
    }

    let kmPerLiter: number | null = null;
    if (data.odometerStatus === 'OK' && data.liters) {
      const prev = await tx.fuelLoad.findFirst({
        where: {
          vehicleId: data.vehicleId,
          status: 'APPROVED',
          odometer: { not: null, lte: data.odometer as number },
          loadDate: { lte: loadDateValue },
        },
        orderBy: { loadDate: 'desc' },
      });
      if (prev && prev.odometer != null) {
        const km = (data.odometer as number) - prev.odometer;
        if (km > 0) kmPerLiter = Math.round((km / data.liters) * 100) / 100;
      }
    }

    // El periodo se bloqueó antes del vehículo; la reserva readquiere ese lock
    // de forma reentrante para conservar un único orden global.
    const reserve = await checkAndReserveFuelBudget(
      tx,
      data.vehicleId,
      data.amount,
      budgetPeriod,
    );
    if (!reserve.allowed) {
      throw new AppError(
        402,
        `Excede presupuesto disponible: $${reserve.available?.toFixed(2)}`,
        'BUDGET_EXCEEDED',
        { available: reserve.available ?? 0 },
      );
    }

    const load = await tx.fuelLoad.create({
      data: {
        vehicleId: data.vehicleId,
        operatorId: operatorMatch?.id ?? null,
        operatorNameRaw: data.operatorName,
        operatorEmployeeRaw: data.operatorEmployee,
        stationId: data.stationId,
        liters: data.liters ?? null,
        amount: data.amount,
        odometer: data.odometerStatus === 'OK' ? (data.odometer as number) : null,
        odometerStatus: data.odometerStatus as OdometerStatus,
        kmPerLiter,
        isApproved: station.isActive,
        status: 'APPROVED',
        requiresReconciliation: false,
        loadDate: loadDateValue,
      },
    });

    // La fila sigue bloqueada: una alta concurrente leerá este valor ya confirmado.
    if (data.odometerStatus === 'OK' && data.odometer != null) {
      await tx.vehicle.update({
        where: { id: data.vehicleId },
        data: { currentOdometer: data.odometer as number },
      });
    }

    return { ...load, amount: Number(load.amount), available: reserve.available };
}

/**
 * Resuelve un operador activo con asignación vigente a la unidad indicada.
 * La respuesta es deliberadamente genérica para no distinguir números de
 * empleado inexistentes, inactivos o pertenecientes a otra unidad.
 */
async function requireActiveAssignedOperator(
  db: Tx,
  employeeNumber: string,
  vehicleId: number,
) {
  const now = new Date();
  const assignment = await db.vehicleAssignment.findFirst({
    where: {
      vehicleId,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
      operator: { is: { employeeNumber, isActive: true } },
    },
    select: {
      operator: { select: { id: true, fullName: true } },
    },
  });

  if (!assignment) {
    throw BadRequest('Operador inválido o sin asignación vigente para este vehículo');
  }

  return assignment.operator;
}

/** Validación compartida por GET /public/verify. */
export function getActiveAssignedPublicOperator(employeeNumber: string, vehicleId: number) {
  return requireActiveAssignedOperator(prisma, employeeNumber, vehicleId);
}

/**
 * Crear carga desde el portal público (operador sin auth).
 * Entra como PENDING_REVIEW para validación posterior.
 */
export async function createPublicFuelLoad(data: PublicFuelLoadInput) {
  return prisma.$transaction((tx) => createPublicFuelLoadInTransaction(tx, data));
}

/** Núcleo aislable para probar que una captura pendiente no produce efectos laterales. */
export async function createPublicFuelLoadInTransaction(tx: Tx, data: PublicFuelLoadInput) {
  // Aunque la captura no toca presupuesto, sí mantiene abierto su periodo
  // hasta revisión; comparte el timeline con el cierre para no aparecer tarde.
  await lockBudgetTimelineShared(tx, 'FUEL');
  const vehicle = await tx.vehicle.findUnique({
    where: { economicNumber: data.vehicleEconomicNumber },
  });
  if (!vehicle) throw NotFound('Número económico');
  if (!vehicle.isActive) throw BadRequest('Vehículo dado de baja');
  if (vehicle.status === 'BLOCKED') {
    throw BadRequest(`Vehículo bloqueado: ${vehicle.blockReason ?? 'documentos vencidos'}`);
  }

  const station = await tx.approvedStation.findUnique({ where: { id: data.stationId } });
  if (!station) throw new AppError(404, 'Gasolinera no encontrada', 'NOT_FOUND');
  if (!station.isActive) throw BadRequest('Gasolinera inactiva');

  const operator = await requireActiveAssignedOperator(
    tx,
    data.operatorEmployee,
    vehicle.id,
  );

  // El valor reportado se conserva para revisión, pero no se aplica al vehículo
  // hasta que exista un flujo de aprobación transaccional.
  if (data.odometerStatus === 'OK') {
    const od = data.odometer as number;
    if (od < vehicle.currentOdometer) {
      throw BadRequest(`Odómetro menor al actual del vehículo (${vehicle.currentOdometer} km)`);
    }
  }

  const now = new Date();
  const budgetPeriod = businessPeriodForDate(now);
  const budget = await tx.vehicleBudget.findUnique({
    where: {
      vehicleId_kind_year_month: {
        vehicleId: vehicle.id,
        kind: 'FUEL',
        year: budgetPeriod.year,
        month: budgetPeriod.month,
      },
    },
    select: { baseAmount: true, rolloverIn: true, spentAmount: true },
  });
  const available = budget
    ? Number(budget.baseAmount) + Number(budget.rolloverIn) - Number(budget.spentAmount)
    : null;

  const load = await tx.fuelLoad.create({
    data: {
      vehicleId: vehicle.id,
      operatorId: operator.id,
      operatorNameRaw: null,
      operatorEmployeeRaw: data.operatorEmployee,
      stationId: data.stationId,
      liters: data.liters ?? null,
      amount: data.amount,
      odometer: data.odometerStatus === 'OK' ? (data.odometer as number) : null,
      odometerStatus: data.odometerStatus as OdometerStatus,
      isApproved: true,
      status: 'PENDING_REVIEW',
      // El default true protege contra escrituras de una API anterior que
      // coexistiera unos segundos durante el despliegue.
      requiresReconciliation: false,
      loadDate: now,
    },
  });

  return {
    folio: load.id,
    status: load.status,
    available,
    vehicle: { id: vehicle.id, plate: vehicle.plate, economicNumber: vehicle.economicNumber },
  };
}

export async function getVehicleMovingAverage(vehicleId: number) {
  const lastLoads = await prisma.fuelLoad.findMany({
    where: { vehicleId, status: 'APPROVED', kmPerLiter: { not: null } },
    orderBy: { loadDate: 'desc' },
    take: 10,
    select: { kmPerLiter: true },
  });
  if (lastLoads.length === 0) return null;
  const sum = lastLoads.reduce((acc, l) => acc + (l.kmPerLiter || 0), 0);
  return Math.round((sum / lastLoads.length) * 100) / 100;
}

interface LockedFuelLoadState {
  id: number;
  status: FuelLoadStatus;
  requiresReconciliation: boolean;
}

async function lockFuelLoadState(tx: Tx, id: number): Promise<LockedFuelLoadState> {
  const rows = await tx.$queryRaw<LockedFuelLoadState[]>`
    SELECT id, status, "requiresReconciliation"
    FROM fuel_loads
    WHERE id = ${id}
    FOR UPDATE
  `;
  if (rows.length === 0) throw NotFound('Carga de combustible');
  return rows[0];
}

async function getFuelLoadForReview(tx: Tx, id: number) {
  const load = await tx.fuelLoad.findUnique({
    where: { id },
    include: {
      vehicle: { select: { id: true, economicNumber: true, plate: true } },
      station: { select: { id: true, legalName: true, tradeName: true, isActive: true } },
      operator: { select: { id: true, fullName: true, employeeNumber: true } },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });
  if (!load) throw NotFound('Carga de combustible');
  return load;
}

function serializeReviewedLoad<T extends { amount: Prisma.Decimal }>(load: T) {
  return { ...load, amount: Number(load.amount) };
}

async function calculateKmPerLiterForApproval(
  tx: Tx,
  load: { id: number; vehicleId: number; odometer: number | null; liters: number | null; loadDate: Date },
) {
  if (load.odometer == null || !load.liters) return null;
  const previous = await tx.fuelLoad.findFirst({
    where: {
      id: { not: load.id },
      vehicleId: load.vehicleId,
      status: 'APPROVED',
      odometer: { not: null, lte: load.odometer },
      loadDate: { lte: load.loadDate },
    },
    orderBy: { loadDate: 'desc' },
    select: { odometer: true },
  });
  if (previous?.odometer == null) return null;
  const distance = load.odometer - previous.odometer;
  return distance > 0 ? Math.round((distance / load.liters) * 100) / 100 : null;
}

/**
 * La aprobación debe respetar el orden cronológico por unidad. Aprobar primero
 * una lectura nueva elevaría el maestro y dejaría una captura anterior
 * imposible de procesar sin una corrección administrativa.
 */
async function assertNoEarlierPendingFuelLoad(
  tx: Tx,
  load: { id: number; vehicleId: number; loadDate: Date },
) {
  const earlier = await tx.fuelLoad.findFirst({
    where: {
      id: { not: load.id },
      vehicleId: load.vehicleId,
      status: 'PENDING_REVIEW',
      OR: [
        { loadDate: { lt: load.loadDate } },
        { loadDate: load.loadDate, id: { lt: load.id } },
      ],
    },
    orderBy: [{ loadDate: 'asc' }, { id: 'asc' }],
    select: { id: true, loadDate: true },
  });
  if (earlier) {
    throw new AppError(
      409,
      `Revisa primero la carga pendiente #${earlier.id} de esta unidad`,
      'EARLIER_FUEL_LOAD_PENDING',
      { blockingFuelLoadId: earlier.id, blockingLoadDate: earlier.loadDate },
    );
  }
}

async function requireVehicleEligibleForApproval(
  tx: Tx,
  load: { vehicleId: number; odometer: number | null; odometerStatus: OdometerStatus },
  effectAlreadyApplied = false,
) {
  const vehicle = await lockVehicleForFuel(tx, load.vehicleId);
  if (!vehicle.isActive) throw Conflict('El vehículo fue dado de baja después de la captura');
  if (vehicle.status === 'BLOCKED') {
    throw Conflict(`El vehículo está bloqueado: ${vehicle.blockReason ?? 'documentos vencidos'}`);
  }
  if (load.odometerStatus === 'OK') {
    if (load.odometer == null) throw Conflict('La captura no contiene un odómetro válido');
    if (!effectAlreadyApplied && load.odometer < vehicle.currentOdometer) {
      throw Conflict(
        `El odómetro reportado (${load.odometer} km) es menor al actual (${vehicle.currentOdometer} km)`,
      );
    }
    if (effectAlreadyApplied && vehicle.currentOdometer < load.odometer) {
      throw Conflict('El odómetro maestro no sustenta el efecto APPLIED declarado');
    }
  }
  return vehicle;
}

async function recordFuelReviewAudit(
  tx: Tx,
  input: {
    id: number;
    actorUserId: number;
    from: FuelLoadStatus;
    to: FuelLoadStatus;
    reason: string;
    reconciliation?: Record<string, unknown>;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: input.actorUserId,
      action: input.reconciliation ? 'FUEL_LOAD_RECONCILE' : 'FUEL_LOAD_REVIEW',
      resource: 'FuelLoad',
      resourceId: String(input.id),
      before: { status: input.from },
      after: { status: input.to },
      metadata: {
        reason: input.reason,
        ...(input.reconciliation ? { reconciliation: input.reconciliation } : {}),
      },
    },
  });
}

/** State machine normal: PENDING_REVIEW -> APPROVED | REJECTED. */
export async function reviewFuelLoad(
  id: number,
  input: FuelLoadReviewInput,
  actorUserId: number,
) {
  return prisma.$transaction(
    (tx) => reviewFuelLoadInTransaction(tx, id, input, actorUserId),
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function reviewFuelLoadInTransaction(
  tx: Tx,
  id: number,
  input: FuelLoadReviewInput,
  actorUserId: number,
) {
  const locked = await lockFuelLoadState(tx, id);
  const target: FuelLoadStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const current = await getFuelLoadForReview(tx, id);

  if (locked.status === target && current.reviewedAt != null) {
    return { ...serializeReviewedLoad(current), idempotent: true };
  }
  if (locked.status !== 'PENDING_REVIEW') {
    throw Conflict(`La carga ya está en estado ${locked.status}`);
  }
  if (locked.requiresReconciliation) {
    throw new AppError(
      409,
      'La carga es histórica y requiere reconciliación administrativa antes de decidirla',
      'RECONCILIATION_REQUIRED',
    );
  }

  let kmPerLiter: number | null = current.kmPerLiter;
  let available: number | null = null;

  if (target === 'APPROVED') {
    const budgetPeriod = businessPeriodForDate(current.loadDate);
    await lockBudgetTimelineShared(tx, 'FUEL');
    await lockBudgetPeriod(tx, 'FUEL', budgetPeriod.year, budgetPeriod.month);
    await assertNoEarlierPendingFuelLoad(tx, current);
    await requireVehicleEligibleForApproval(tx, current);
    await lockActiveStation(tx, current.stationId);

    const reserve = await checkAndReserveFuelBudget(
      tx,
      current.vehicleId,
      Number(current.amount),
      budgetPeriod,
    );
    if (!reserve.allowed) {
      throw new AppError(
        402,
        `Excede presupuesto disponible: $${reserve.available?.toFixed(2)}`,
        'BUDGET_EXCEEDED',
        { available: reserve.available ?? 0 },
      );
    }
    available = reserve.available;
    kmPerLiter = await calculateKmPerLiterForApproval(tx, current);

    if (current.odometerStatus === 'OK' && current.odometer != null) {
      await tx.vehicle.update({
        where: { id: current.vehicleId },
        data: { currentOdometer: current.odometer },
      });
    }
  }

  const updated = await tx.fuelLoad.update({
    where: { id },
    data: {
      status: target,
      reviewedAt: new Date(),
      reviewedById: actorUserId,
      reviewReason: input.reason,
      kmPerLiter: target === 'APPROVED' ? kmPerLiter : null,
    },
    include: {
      vehicle: { select: { id: true, economicNumber: true, plate: true } },
      station: { select: { id: true, legalName: true, tradeName: true, isActive: true } },
      operator: { select: { id: true, fullName: true, employeeNumber: true } },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });

  await recordFuelReviewAudit(tx, {
    id,
    actorUserId,
    from: locked.status,
    to: target,
    reason: input.reason,
  });

  return { ...serializeReviewedLoad(updated), available, idempotent: false };
}

async function assertBudgetEffectClaim(
  tx: Tx,
  load: { vehicleId: number; loadDate: Date },
  claim: LegacyFuelLoadReconciliationInput['budgetEffect'],
  period = businessPeriodForDate(load.loadDate),
) {
  const budget = await tx.vehicleBudget.findUnique({
    where: {
      vehicleId_kind_year_month: {
        vehicleId: load.vehicleId,
        kind: 'FUEL',
        year: period.year,
        month: period.month,
      },
    },
    select: { id: true },
  });
  if (claim === 'NO_BUDGET' && budget) {
    throw Conflict('Existe presupuesto en el periodo; la declaración NO_BUDGET es inconsistente');
  }
  if (claim === 'APPLIED' && !budget) {
    throw Conflict('No existe presupuesto en el periodo para sustentar el efecto declarado');
  }
  return { period, budget };
}

interface HistoricalOdometerCorrection {
  before: number;
  after: number;
  evidenceFloor: number;
}

/** Corrige el maestro en la misma transacción que rechaza la captura heredada. */
async function applyRejectedHistoricalOdometerCorrection(
  tx: Tx,
  load: { id: number; vehicleId: number; odometer: number | null },
  correctedOdometer: number | undefined,
  actorUserId: number,
  reason: string,
): Promise<HistoricalOdometerCorrection> {
  if (correctedOdometer == null) {
    throw BadRequest(
      'El odómetro corregido es obligatorio al rechazar una carga cuyo efecto fue aplicado',
    );
  }

  const vehicle = await lockVehicleForFuel(tx, load.vehicleId);
  if (correctedOdometer > vehicle.currentOdometer) {
    throw Conflict(
      `La corrección (${correctedOdometer} km) no puede aumentar el odómetro actual (${vehicle.currentOdometer} km)`,
    );
  }

  const [approvedFuel, maintenance] = await Promise.all([
    tx.fuelLoad.aggregate({
      where: {
        vehicleId: load.vehicleId,
        status: 'APPROVED',
        odometerStatus: 'OK',
        odometer: { not: null },
      },
      _max: { odometer: true },
    }),
    tx.maintenanceRecord.aggregate({
      where: {
        vehicleId: load.vehicleId,
        odometerStatus: 'OK',
        odometer: { not: null },
      },
      _max: { odometer: true },
    }),
  ]);
  const evidenceFloor = Math.max(
    0,
    approvedFuel._max.odometer ?? 0,
    maintenance._max.odometer ?? 0,
  );
  if (correctedOdometer < evidenceFloor) {
    throw Conflict(
      `La corrección no puede ser menor a la última lectura aprobada (${evidenceFloor} km)`,
    );
  }

  await tx.vehicle.update({
    where: { id: load.vehicleId },
    data: { currentOdometer: correctedOdometer },
  });
  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: 'ODOMETER_CORRECTION',
      resource: 'Vehicle',
      resourceId: String(load.vehicleId),
      before: { currentOdometer: vehicle.currentOdometer },
      after: { currentOdometer: correctedOdometer },
      metadata: {
        source: 'FUEL_LOAD_RECONCILIATION',
        fuelLoadId: load.id,
        rejectedReportedOdometer: load.odometer,
        evidenceFloor,
        reason,
      },
    },
  });

  return { before: vehicle.currentOdometer, after: correctedOdometer, evidenceFloor };
}

/**
 * Decide una carga heredada solo con hechos aportados por un ADMIN. Cuando un
 * rechazo exige corregir odómetro, valida evidencia y lo hace en esta transacción.
 */
export async function reconcileLegacyFuelLoad(
  id: number,
  input: LegacyFuelLoadReconciliationInput,
  actorUserId: number,
) {
  return prisma.$transaction(
    (tx) => reconcileLegacyFuelLoadInTransaction(tx, id, input, actorUserId),
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function reconcileLegacyFuelLoadInTransaction(
  tx: Tx,
  id: number,
  input: LegacyFuelLoadReconciliationInput,
  actorUserId: number,
) {
  const locked = await lockFuelLoadState(tx, id);
  const target: FuelLoadStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const current = await getFuelLoadForReview(tx, id);

  if (locked.status === target && current.reviewedAt != null && !locked.requiresReconciliation) {
    return { ...serializeReviewedLoad(current), idempotent: true };
  }
  if (locked.status !== 'PENDING_REVIEW' || !locked.requiresReconciliation) {
    throw Conflict('La carga no es un pendiente histórico reconciliable');
  }
  if (current.odometerStatus === 'NF' && input.odometerEffect === 'APPLIED') {
    throw BadRequest('Una captura con odómetro NF no puede declarar efecto de odómetro aplicado');
  }

  const reconciliationPeriod = businessPeriodForDate(current.loadDate);
  await lockBudgetTimelineShared(tx, 'FUEL');
  await lockBudgetPeriod(
    tx,
    'FUEL',
    reconciliationPeriod.year,
    reconciliationPeriod.month,
  );
  const budgetClaim = await assertBudgetEffectClaim(
    tx,
    current,
    input.budgetEffect,
    reconciliationPeriod,
  );
  let available: number | null = null;
  let odometerCorrection: HistoricalOdometerCorrection | null = null;
  let kmPerLiter: number | null = current.kmPerLiter;

  if (target === 'APPROVED') {
    await assertNoEarlierPendingFuelLoad(tx, current);
    await requireVehicleEligibleForApproval(
      tx,
      current,
      input.odometerEffect === 'APPLIED',
    );
    await lockActiveStation(tx, current.stationId);

    if (input.budgetEffect === 'NOT_APPLIED') {
      const reserve = await checkAndReserveFuelBudget(
        tx,
        current.vehicleId,
        Number(current.amount),
        budgetClaim.period,
      );
      if (!reserve.allowed) {
        throw new AppError(402, 'El presupuesto disponible ya no permite aprobar la carga', 'BUDGET_EXCEEDED');
      }
      available = reserve.available;
    }

    if (current.odometerStatus === 'OK' && current.odometer != null) {
      if (input.odometerEffect !== 'APPLIED') {
        await tx.vehicle.update({
          where: { id: current.vehicleId },
          data: { currentOdometer: current.odometer },
        });
      }
    }
    kmPerLiter = await calculateKmPerLiterForApproval(tx, current);
  } else {
    if (input.budgetEffect === 'APPLIED') {
      const released = await releaseFuelBudget(
        tx,
        current.vehicleId,
        Number(current.amount),
        budgetClaim.period,
      );
      available = released.availableAfterRelease;
    }
    // La corrección declarada no puede borrar lecturas aprobadas posteriores.
    if (input.odometerEffect === 'APPLIED') {
      odometerCorrection = await applyRejectedHistoricalOdometerCorrection(
        tx,
        current,
        input.correctedOdometer,
        actorUserId,
        input.reason,
      );
    }
  }

  const updated = await tx.fuelLoad.update({
    where: { id },
    data: {
      status: target,
      reviewedAt: new Date(),
      reviewedById: actorUserId,
      reviewReason: input.reason,
      requiresReconciliation: false,
      kmPerLiter: target === 'APPROVED' ? kmPerLiter : null,
    },
    include: {
      vehicle: { select: { id: true, economicNumber: true, plate: true } },
      station: { select: { id: true, legalName: true, tradeName: true, isActive: true } },
      operator: { select: { id: true, fullName: true, employeeNumber: true } },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });

  await recordFuelReviewAudit(tx, {
    id,
    actorUserId,
    from: locked.status,
    to: target,
    reason: input.reason,
    reconciliation: {
      budgetEffect: input.budgetEffect,
      odometerEffect: input.odometerEffect,
      correctedOdometer: input.correctedOdometer ?? null,
      odometerCorrection,
    },
  });

  return {
    ...serializeReviewedLoad(updated),
    available,
    odometerCorrection,
    idempotent: false,
  };
}

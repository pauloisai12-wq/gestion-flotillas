// /api/src/services/fuelLoadService.ts
// Servicio v2 — cargas con odómetro NF, operador texto libre,
// reserva atómica de presupuesto con lock pesimista.

import prisma from '../lib/prisma';
import { FuelLoadInput, PublicFuelLoadInput } from '../validators/fuelLoadValidator';
import { checkAndReserveFuelBudget } from './budgetService';
import { FuelLoadStatus, OdometerStatus, Prisma } from '@prisma/client';

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
      orderBy: { loadDate: 'desc' },
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

/** Crear carga desde el dashboard (autenticado) */
export async function createFuelLoad(data: FuelLoadInput) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: data.vehicleId },
    include: { vehicleType: true },
  });
  if (!vehicle) throw new Error('Vehículo no encontrado');

  const station = await prisma.approvedStation.findUnique({ where: { id: data.stationId } });
  if (!station) throw new Error('Gasolinera no encontrada');

  // Match de operador por employeeNumber (si existe)
  const operatorMatch = await prisma.operator.findUnique({
    where: { employeeNumber: data.operatorEmployee },
  });

  // Validar odómetro progresivo solo si OK
  if (data.odometerStatus === 'OK') {
    const od = data.odometer as number;
    if (od < vehicle.currentOdometer) {
      throw new Error(`El odómetro (${od} km) no puede ser menor al actual (${vehicle.currentOdometer} km)`);
    }
  }

  // km/l calculable solo si hay odómetro y carga previa con odómetro
  let kmPerLiter: number | null = null;
  if (data.odometerStatus === 'OK' && data.liters) {
    const prev = await prisma.fuelLoad.findFirst({
      where: { vehicleId: data.vehicleId, odometer: { not: null } },
      orderBy: { loadDate: 'desc' },
    });
    if (prev && prev.odometer != null) {
      const km = (data.odometer as number) - prev.odometer;
      if (km > 0) kmPerLiter = Math.round((km / data.liters) * 100) / 100;
    }
  }

  const isApproved = station.isActive;

  return prisma.$transaction(async (tx) => {
    // 1. Reservar presupuesto (lock + update)
    const reserve = await checkAndReserveFuelBudget(tx, data.vehicleId, data.amount);
    if (!reserve.allowed) {
      throw new Error(`Excede presupuesto disponible: $${reserve.available?.toFixed(2)}`);
    }

    // 2. Insertar carga
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
        isApproved,
        status: 'APPROVED',
        loadDate: data.loadDate ? new Date(data.loadDate) : new Date(),
      },
    });

    // 3. Actualizar odómetro del vehículo si corresponde
    if (data.odometerStatus === 'OK' && data.odometer != null) {
      await tx.vehicle.update({
        where: { id: data.vehicleId },
        data: { currentOdometer: data.odometer as number },
      });
    }

    return { ...load, amount: Number(load.amount), available: reserve.available };
  });
}

/**
 * Crear carga desde el portal público (operador sin auth).
 * Entra como PENDING_REVIEW para validación posterior.
 */
export async function createPublicFuelLoad(data: PublicFuelLoadInput) {
  // Resolver vehículo por economic_number
  const vehicle = await prisma.vehicle.findUnique({
    where: { economicNumber: data.vehicleEconomicNumber },
    include: { vehicleType: true },
  });
  if (!vehicle) throw new Error('Número económico no encontrado');
  if (!vehicle.isActive) throw new Error('Vehículo dado de baja');
  if (vehicle.status === 'BLOCKED') throw new Error(`Vehículo bloqueado: ${vehicle.blockReason ?? 'documentos vencidos'}`);

  const station = await prisma.approvedStation.findUnique({ where: { id: data.stationId } });
  if (!station) throw new Error('Gasolinera no encontrada');

  // Match de operador
  const operatorMatch = await prisma.operator.findUnique({
    where: { employeeNumber: data.operatorEmployee },
  });

  // Validar odómetro si OK
  if (data.odometerStatus === 'OK') {
    const od = data.odometer as number;
    if (od < vehicle.currentOdometer) {
      throw new Error(`Odómetro menor al actual del vehículo (${vehicle.currentOdometer} km)`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const reserve = await checkAndReserveFuelBudget(tx, vehicle.id, data.amount);
    if (!reserve.allowed) {
      const err: Error & { code?: string; available?: number } = new Error(
        `Sin presupuesto disponible. Restante: $${(reserve.available ?? 0).toFixed(2)}`,
      );
      err.code = 'BUDGET_EXCEEDED';
      err.available = reserve.available ?? 0;
      throw err;
    }

    const load = await tx.fuelLoad.create({
      data: {
        vehicleId: vehicle.id,
        operatorId: operatorMatch?.id ?? null,
        operatorNameRaw: null,  // portal no pide nombre si lo resolvemos del operator match
        operatorEmployeeRaw: data.operatorEmployee,
        stationId: data.stationId,
        liters: data.liters ?? null,
        amount: data.amount,
        odometer: data.odometerStatus === 'OK' ? (data.odometer as number) : null,
        odometerStatus: data.odometerStatus as OdometerStatus,
        isApproved: station.isActive,
        status: 'PENDING_REVIEW', // siempre entra pendiente
        loadDate: new Date(),
      },
    });

    if (data.odometerStatus === 'OK' && data.odometer != null) {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { currentOdometer: data.odometer as number },
      });
    }

    return {
      folio: load.id,
      status: load.status,
      available: reserve.available,
      vehicle: { id: vehicle.id, plate: vehicle.plate, economicNumber: vehicle.economicNumber },
    };
  });
}

export async function getVehicleMovingAverage(vehicleId: number) {
  const lastLoads = await prisma.fuelLoad.findMany({
    where: { vehicleId, kmPerLiter: { not: null } },
    orderBy: { loadDate: 'desc' },
    take: 10,
    select: { kmPerLiter: true },
  });
  if (lastLoads.length === 0) return null;
  const sum = lastLoads.reduce((acc, l) => acc + (l.kmPerLiter || 0), 0);
  return Math.round((sum / lastLoads.length) * 100) / 100;
}

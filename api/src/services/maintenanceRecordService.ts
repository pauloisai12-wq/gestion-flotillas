// api/src/services/maintenanceRecordService.ts
// CRUD para registros de mantenimiento realizados.
// Al registrar un mantenimiento, se reinicia el contador de km para ese servicio.

import prisma from '../lib/prisma';
import { MaintenanceInput } from '../validators/maintenanceValidator';

/**
 * Obtener todos los registros de mantenimiento con filtros opcionales.
 */
export async function getAll(query: {
  page?: number;
  limit?: number;
  vehicleId?: number;
  serviceId?: number;
}) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (query.vehicleId) where.vehicleId = query.vehicleId;
  if (query.serviceId) where.serviceId = query.serviceId;

  const [records, total] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: { serviceDate: 'desc' },
      include: {
        vehicle: {
          select: { id: true, plate: true, economicNumber: true },
        },
        service: {
          select: { id: true, name: true, intervalKm: true },
        },
      },
    }),
    prisma.maintenanceRecord.count({ where }),
  ]);

  return {
    data: records,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Obtener registros de mantenimiento de un vehículo específico.
 */
export async function getByVehicle(vehicleId: number) {
  return prisma.maintenanceRecord.findMany({
    where: { vehicleId },
    orderBy: { serviceDate: 'desc' },
    include: {
      service: {
        select: { id: true, name: true, intervalKm: true },
      },
    },
  });
}

/**
 * Registrar un mantenimiento realizado.
 * Esto reinicia el contador de km para ese servicio en ese vehículo.
 */
export async function create(data: MaintenanceInput, evidenceUrl?: string) {
  // Verificar que el vehículo existe
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: data.vehicleId },
  });
  if (!vehicle) throw new Error('Vehículo no encontrado');

  // Verificar que el servicio existe
  const service = await prisma.serviceCatalog.findUnique({
    where: { id: data.serviceId },
  });
  if (!service) throw new Error('Servicio no encontrado');

  // Verificar que el servicio corresponde al tipo de vehículo
  if (service.vehicleTypeId !== vehicle.vehicleTypeId) {
    throw new Error(
      'El servicio "' + service.name +
      '" no corresponde al tipo de vehículo de esta unidad'
    );
  }

  // Crear el registro dentro de una transacción
  const result = await prisma.$transaction(async function(tx) {
    // 1. Crear el registro de mantenimiento
    const record = await tx.maintenanceRecord.create({
      data: {
        vehicleId: data.vehicleId,
        serviceId: data.serviceId,
        odometer: data.odometerStatus === 'OK' ? (data.odometer as number) : null,
        odometerStatus: data.odometerStatus,
        cost: data.cost,
        workshopId: data.workshopId ?? null,
        workshopRaw: data.workshopRaw ?? null,
        serviceDate: new Date(data.serviceDate),
        notes: data.notes || null,
        evidenceUrl: evidenceUrl || null,
      },
      include: {
        vehicle: { select: { id: true, plate: true, economicNumber: true } },
        service: { select: { id: true, name: true, intervalKm: true } },
        workshopRef: { select: { id: true, legalName: true, tradeName: true } },
      },
    });

    // 2. Actualizar odómetro del vehículo si es OK y mayor al actual
    if (data.odometerStatus === 'OK' && data.odometer != null && data.odometer > vehicle.currentOdometer) {
      await tx.vehicle.update({
        where: { id: data.vehicleId },
        data: { currentOdometer: data.odometer },
      });
    }

    return record;
  });

  return result;
}

/**
 * Actualizar un registro de mantenimiento.
 */
export async function update(id: number, data: MaintenanceInput, evidenceUrl?: string) {
  const existing = await prisma.maintenanceRecord.findUnique({ where: { id } });
  if (!existing) throw new Error('Registro no encontrado');

  return prisma.maintenanceRecord.update({
    where: { id },
    data: {
      odometer: data.odometerStatus === 'OK' ? (data.odometer as number) : null,
      odometerStatus: data.odometerStatus,
      cost: data.cost,
      workshopId: data.workshopId ?? null,
      workshopRaw: data.workshopRaw ?? null,
      serviceDate: new Date(data.serviceDate),
      notes: data.notes || null,
      evidenceUrl: evidenceUrl !== undefined ? evidenceUrl : existing.evidenceUrl,
    },
    include: {
      vehicle: { select: { id: true, plate: true, economicNumber: true } },
      service: { select: { id: true, name: true, intervalKm: true } },
      workshopRef: { select: { id: true, legalName: true, tradeName: true } },
    },
  });
}

/**
 * Eliminar un registro de mantenimiento.
 */
export async function remove(id: number) {
  const existing = await prisma.maintenanceRecord.findUnique({ where: { id } });
  if (!existing) throw new Error('Registro no encontrado');

  return prisma.maintenanceRecord.delete({ where: { id } });
}
// api/src/services/maintenanceRecordService.ts
// CRUD para registros de mantenimiento realizados.
// Al registrar un mantenimiento, se reinicia el contador de km para ese servicio.

import prisma, { Tx } from '../lib/prisma';
import { MaintenanceInput } from '../validators/maintenanceValidator';
import { NotFound, BadRequest } from '../middlewares/errorHandler';
import { lockOpenBudgetPeriod } from './budgetPeriodLock';
import { businessPeriodForDate } from '../lib/businessTime';

interface LockedMaintenanceVehicle {
  id: number;
  vehicleTypeId: number;
  currentOdometer: number;
  isActive: boolean;
}

interface LockedMaintenanceRecord {
  id: number;
  vehicleId: number;
  serviceDate: Date;
  evidenceUrl: string | null;
}

async function lockMaintenanceRecord(tx: Tx, id: number): Promise<LockedMaintenanceRecord> {
  const rows = await tx.$queryRaw<LockedMaintenanceRecord[]>`
    SELECT id, "vehicleId", "serviceDate", "evidenceUrl"
    FROM maintenance_records
    WHERE id = ${id}
    FOR UPDATE
  `;
  if (rows.length === 0) throw NotFound('Registro');
  return rows[0];
}

function orderedUniquePeriods(...periods: Array<{ year: number; month: number }>) {
  return [...new Map(
    periods.map((period) => [`${period.year}-${period.month}`, period]),
  ).values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Serializa cualquier escritura operativa con la baja lógica y con las otras
 * fuentes del odómetro maestro (combustible/corrección administrativa).
 */
async function lockActiveVehicle(tx: Tx, vehicleId: number): Promise<LockedMaintenanceVehicle> {
  const rows = await tx.$queryRaw<LockedMaintenanceVehicle[]>`
    SELECT id, "vehicleTypeId", "currentOdometer", "isActive"
    FROM vehicles
    WHERE id = ${vehicleId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw NotFound('Vehículo');
  if (!rows[0].isActive) throw BadRequest('El vehículo está dado de baja');
  return rows[0];
}

function maintenancePeriod(serviceDate: string) {
  // Los formularios envían fecha civil YYYY-MM-DD; no debe correrse al mes
  // anterior al interpretarla como medianoche UTC en America/Mexico_City.
  const civilDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  if (civilDate) return { year: Number(civilDate[1]), month: Number(civilDate[2]) };

  const parsed = new Date(serviceDate);
  if (Number.isNaN(parsed.getTime())) throw BadRequest('Fecha de servicio inválida');
  return businessPeriodForDate(parsed);
}

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
export async function getByVehicle(
  vehicleId: number,
  query: { page?: number; limit?: number } = {},
) {
  return getAll({ ...query, vehicleId });
}

/**
 * Registrar un mantenimiento realizado.
 * Esto reinicia el contador de km para ese servicio en ese vehículo.
 */
export async function create(data: MaintenanceInput, evidenceUrl?: string) {
  // Lectura, validación, alta y posible avance del odómetro comparten el lock.
  const result = await prisma.$transaction(async function(tx) {
    const period = maintenancePeriod(data.serviceDate);
    await lockOpenBudgetPeriod(tx, 'MAINTENANCE', period.year, period.month);
    const vehicle = await lockActiveVehicle(tx, data.vehicleId);

    const service = await tx.serviceCatalog.findUnique({
      where: { id: data.serviceId },
    });
    if (!service) throw NotFound('Servicio');

    if (service.vehicleTypeId !== vehicle.vehicleTypeId) {
      throw BadRequest(
        'El servicio "' + service.name +
        '" no corresponde al tipo de vehículo de esta unidad'
      );
    }

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

    // El lock impide que una lectura obsoleta reduzca el maestro bajo concurrencia.
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
  return prisma.$transaction(async (tx) => {
    const existing = await lockMaintenanceRecord(tx, id);
    const originalPeriod = businessPeriodForDate(existing.serviceDate);
    const targetPeriod = maintenancePeriod(data.serviceDate);
    for (const period of orderedUniquePeriods(originalPeriod, targetPeriod)) {
      await lockOpenBudgetPeriod(tx, 'MAINTENANCE', period.year, period.month);
    }
    await lockActiveVehicle(tx, existing.vehicleId);

    return tx.maintenanceRecord.update({
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
  });
}

/**
 * Eliminar un registro de mantenimiento.
 */
export async function remove(id: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await lockMaintenanceRecord(tx, id);
    const period = businessPeriodForDate(existing.serviceDate);
    await lockOpenBudgetPeriod(tx, 'MAINTENANCE', period.year, period.month);
    await lockActiveVehicle(tx, existing.vehicleId);
    return tx.maintenanceRecord.delete({ where: { id } });
  });
}

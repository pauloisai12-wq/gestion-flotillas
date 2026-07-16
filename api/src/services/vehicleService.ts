// Operaciones CRUD de vehículos contra la base de datos
import { Prisma, VehicleStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import {
  OdometerCorrectionInput,
  VehicleInput,
  VehicleUpdateInput,
} from '../validators/vehicleValidator';
import {
  NotFound,
  Conflict,
  BadRequest,
  isPrismaKnownError,
} from '../middlewares/errorHandler';
import { getAuditContext } from '../lib/auditContext';
import { deactivateVehicleInTransaction } from './vehicleDeactivationService';

// Interfaz para filtros y paginación
interface VehicleQuery {
  page?: number;
  limit?: number;
  search?: string;
  vehicleTypeId?: number;
  status?: VehicleStatus;
  /// Filtra por User responsable. Útil para el dropdown del ejecutor.
  executorId?: number;
}

/**
 * Obtener lista paginada de vehículos con filtros.
 */
export async function getAllVehicles(query: VehicleQuery) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  // Construir filtro dinámico
  // Las bajas son lógicas: las listas operativas nunca deben reintroducirlas.
  const where: Prisma.VehicleWhereInput = { isActive: true };

  if (query.search) {
    where.OR = [
      { plate: { contains: query.search, mode: 'insensitive' } },
      { economicNumber: { contains: query.search, mode: 'insensitive' } },
      { brand: { contains: query.search, mode: 'insensitive' } },
      { model: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  if (query.vehicleTypeId) {
    where.vehicleTypeId = query.vehicleTypeId;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.executorId) {
    where.executorId = query.executorId;
  }

  // Ejecutar consulta y conteo en paralelo
  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      skip,
      take: limit,
      orderBy: { economicNumber: 'asc' },
      include: {
        vehicleType: {
          select: { name: true, expectedKmPerLiter: true },
        },
        // Incluir el peor estado de documentos para la columna resumen
        documents: {
          select: { expiresAt: true },
        },
        _count: {
          select: { fuelLoads: true, maintenanceRecords: true },
        },
      },
    }),
    prisma.vehicle.count({ where }),
  ]);

  return {
    data: vehicles,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Obtener un vehículo por ID con todas sus relaciones.
 */
export async function getVehicleById(id: number) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      vehicleType: true,
      documents: {
        orderBy: { expiresAt: 'asc' },
      },
      assignments: {
        include: {
          operator: {
            select: { id: true, fullName: true, licenseNumber: true },
          },
        },
        orderBy: { startDate: 'desc' },
        take: 5,
      },
      _count: {
        select: {
          fuelLoads: true,
          maintenanceRecords: true,
          documents: true,
        },
      },
    },
  });

  if (!vehicle) {
    throw NotFound('Vehículo');
  }

  return vehicle;
}

/**
 * Crear un nuevo vehículo.
 */
export async function createVehicle(data: VehicleInput) {
  // Verificar placa única
  const existingPlate = await prisma.vehicle.findUnique({
    where: { plate: data.plate },
  });
  if (existingPlate) {
    throw Conflict(`Ya existe un vehículo con la placa "${data.plate}"`);
  }

  // Verificar número económico único
  const existingEco = await prisma.vehicle.findUnique({
    where: { economicNumber: data.economicNumber },
  });
  if (existingEco) {
    throw Conflict(`Ya existe un vehículo con el número económico "${data.economicNumber}"`);
  }

  // Verificar que el tipo de vehículo existe
  const vehicleType = await prisma.vehicleType.findUnique({
    where: { id: data.vehicleTypeId },
  });
  if (!vehicleType) {
    throw BadRequest('El tipo de vehículo seleccionado no existe');
  }

  return prisma.vehicle.create({
    data: {
      plate: data.plate.toUpperCase(),
      economicNumber: data.economicNumber,
      vehicleTypeId: data.vehicleTypeId,
      brand: data.brand,
      model: data.model,
      year: data.year,
      vin: data.vin || null,
      color: data.color || null,
      currentOdometer: data.currentOdometer || 0,
      classification: data.classification,
      sectorId: data.sectorId,
      isActive: data.isActive ?? true,
    },
    include: {
      vehicleType: {
        select: { name: true },
      },
    },
  });
}

/**
 * Actualizar un vehículo existente.
 */
export async function updateVehicle(id: number, data: VehicleUpdateInput) {
  const current = await prisma.vehicle.findUnique({
    where: { id },
    select: { id: true, isActive: true },
  });
  if (!current || !current.isActive) throw NotFound('Vehículo activo');

  // Verificar placa única (excluyendo el actual)
  const existingPlate = await prisma.vehicle.findFirst({
    where: { plate: data.plate, NOT: { id } },
  });
  if (existingPlate) {
    throw Conflict(`Ya existe otro vehículo con la placa "${data.plate}"`);
  }

  // Verificar número económico único
  const existingEco = await prisma.vehicle.findFirst({
    where: { economicNumber: data.economicNumber, NOT: { id } },
  });
  if (existingEco) {
    throw Conflict(`Ya existe otro vehículo con el número económico "${data.economicNumber}"`);
  }

  try {
    return await prisma.vehicle.update({
      where: {
        id,
        isActive: true,
        updatedAt: new Date(data.expectedUpdatedAt),
      },
      data: {
        plate: data.plate.toUpperCase(),
        economicNumber: data.economicNumber,
        vehicleTypeId: data.vehicleTypeId,
        classification: data.classification,
        sectorId: data.sectorId,
        brand: data.brand,
        model: data.model,
        year: data.year,
        vin: data.vin || null,
        color: data.color || null,
      },
      include: {
        vehicleType: {
          select: { name: true },
        },
      },
    });
  } catch (error: unknown) {
    if (!isPrismaKnownError(error, 'P2025')) throw error;

    const latest = await prisma.vehicle.findUnique({
      where: { id },
      select: { isActive: true, updatedAt: true },
    });
    if (!latest || !latest.isActive) throw NotFound('Vehículo activo');
    throw Conflict(
      'El vehículo cambió desde que abriste el formulario. Recarga los datos antes de guardar.',
    );
  }
}

/**
 * Baja lógica de un vehículo. No elimina documentos, asignaciones ni ningún
 * otro registro histórico relacionado.
 */
export async function deleteVehicle(id: number, actorUserId: number) {
  const result = await prisma.$transaction(
    (tx) => deactivateVehicleInTransaction(tx, id, {
      actorUserId,
      source: 'ADMIN_DELETE',
    }),
    { timeout: 20_000, maxWait: 10_000 },
  );
  return result.vehicle;
}

/**
 * Corrección excepcional del odómetro maestro. Puede reducirlo, pero solo por
 * el endpoint ADMIN y dejando antes/después + motivo en el audit log.
 */
export async function correctVehicleOdometer(
  id: number,
  input: OdometerCorrectionInput,
  userId: number,
) {
  const auditContext = getAuditContext();

  return prisma.$transaction(async (tx) => {
    const current = await tx.vehicle.findUnique({
      where: { id },
      select: { id: true, isActive: true, currentOdometer: true, updatedAt: true },
    });
    if (!current || !current.isActive) throw NotFound('Vehículo activo');

    let updated;
    try {
      updated = await tx.vehicle.update({
        where: {
          id,
          isActive: true,
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        data: { currentOdometer: input.newOdometer },
        select: { id: true, currentOdometer: true, updatedAt: true },
      });
    } catch (error: unknown) {
      if (!isPrismaKnownError(error, 'P2025')) throw error;
      throw Conflict(
        'El odómetro cambió antes de confirmar la corrección. Recarga e intenta de nuevo.',
      );
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: 'ODOMETER_CORRECTION',
        resource: 'Vehicle',
        resourceId: String(id),
        before: { currentOdometer: current.currentOdometer },
        after: { currentOdometer: updated.currentOdometer },
        metadata: { reason: input.reason },
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
        requestId: auditContext?.requestId,
      },
    });

    return updated;
  });
}

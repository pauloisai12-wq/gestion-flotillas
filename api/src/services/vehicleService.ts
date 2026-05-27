// Archivo: /flotillas/api/src/services/vehicleService.ts
// NUEVO: Operaciones CRUD de vehículos contra la base de datos
import prisma from '../lib/prisma';
import { VehicleInput } from '../validators/vehicleValidator';

// Interfaz para filtros y paginación
interface VehicleQuery {
  page?: number;
  limit?: number;
  search?: string;
  vehicleTypeId?: number;
  status?: string;
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
  const where: any = {};

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
    throw new Error('Vehículo no encontrado');
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
    throw new Error(`Ya existe un vehículo con la placa "${data.plate}"`);
  }

  // Verificar número económico único
  const existingEco = await prisma.vehicle.findUnique({
    where: { economicNumber: data.economicNumber },
  });
  if (existingEco) {
    throw new Error(`Ya existe un vehículo con el número económico "${data.economicNumber}"`);
  }

  // Verificar que el tipo de vehículo existe
  const vehicleType = await prisma.vehicleType.findUnique({
    where: { id: data.vehicleTypeId },
  });
  if (!vehicleType) {
    throw new Error('El tipo de vehículo seleccionado no existe');
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
export async function updateVehicle(id: number, data: VehicleInput) {
  // Verificar que existe
  await getVehicleById(id);

  // Verificar placa única (excluyendo el actual)
  const existingPlate = await prisma.vehicle.findFirst({
    where: { plate: data.plate, NOT: { id } },
  });
  if (existingPlate) {
    throw new Error(`Ya existe otro vehículo con la placa "${data.plate}"`);
  }

  // Verificar número económico único
  const existingEco = await prisma.vehicle.findFirst({
    where: { economicNumber: data.economicNumber, NOT: { id } },
  });
  if (existingEco) {
    throw new Error(`Ya existe otro vehículo con el número económico "${data.economicNumber}"`);
  }

  return prisma.vehicle.update({
    where: { id },
    data: {
      plate: data.plate.toUpperCase(),
      economicNumber: data.economicNumber,
      vehicleTypeId: data.vehicleTypeId,
      brand: data.brand,
      model: data.model,
      year: data.year,
      vin: data.vin || null,
      color: data.color || null,
      currentOdometer: data.currentOdometer,
      isActive: data.isActive,
    },
    include: {
      vehicleType: {
        select: { name: true },
      },
    },
  });
}

/**
 * Eliminar un vehículo.
 * Solo si no tiene cargas de combustible ni mantenimientos registrados.
 */
export async function deleteVehicle(id: number) {
  const vehicle = await getVehicleById(id);

  if (vehicle._count.fuelLoads > 0 || vehicle._count.maintenanceRecords > 0) {
    throw new Error(
      'No se puede eliminar: el vehículo tiene registros de combustible o mantenimiento asociados'
    );
  }

  // Eliminar documentos asociados primero
  await prisma.document.deleteMany({ where: { vehicleId: id } });
  await prisma.vehicleAssignment.deleteMany({ where: { vehicleId: id } });

  return prisma.vehicle.delete({ where: { id } });
}
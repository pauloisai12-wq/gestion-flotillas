// Archivo: /flotillas/api/src/services/vehicleTypeService.ts
// NUEVO: Operaciones CRUD de tipos de vehículo contra la base de datos
import prisma from '../lib/prisma';
import { VehicleTypeInput } from '../validators/vehicleTypeValidator';
import { NotFound, Conflict } from '../middlewares/errorHandler';

/**
 * Obtener todos los tipos de vehículo.
 * Retorna ordenados por nombre alfabéticamente.
 */
export async function getAllVehicleTypes() {
  return prisma.vehicleType.findMany({
    orderBy: { name: 'asc' },
    // Incluir cuántos vehículos tiene cada tipo (útil para la tabla)
    include: {
      _count: {
        select: { vehicles: true },
      },
    },
  });
}

/**
 * Obtener un tipo de vehículo por su ID.
 */
export async function getVehicleTypeById(id: number) {
  const vehicleType = await prisma.vehicleType.findUnique({
    where: { id },
    include: {
      _count: {
        select: { vehicles: true },
      },
    },
  });

  if (!vehicleType) {
    throw NotFound('Tipo de vehículo');
  }

  return vehicleType;
}

/**
 * Crear un nuevo tipo de vehículo.
 * Valida que el nombre no exista ya.
 */
export async function createVehicleType(data: VehicleTypeInput) {
  // Verificar nombre único (Prisma lanzaría error, pero damos mensaje claro)
  const existing = await prisma.vehicleType.findUnique({
    where: { name: data.name },
  });

  if (existing) {
    throw Conflict(`Ya existe un tipo de vehículo con el nombre "${data.name}"`);
  }

  return prisma.vehicleType.create({
    data: {
      name: data.name,
      expectedKmPerLiter: data.expectedKmPerLiter,
      isActive: data.isActive ?? true,
    },
  });
}

/**
 * Actualizar un tipo de vehículo existente.
 */
export async function updateVehicleType(id: number, data: VehicleTypeInput) {
  // Verificar que existe
  await getVehicleTypeById(id);

  // Verificar nombre único (excluyendo el registro actual)
  const existing = await prisma.vehicleType.findFirst({
    where: {
      name: data.name,
      NOT: { id },
    },
  });

  if (existing) {
    throw Conflict(`Ya existe otro tipo de vehículo con el nombre "${data.name}"`);
  }

  return prisma.vehicleType.update({
    where: { id },
    data: {
      name: data.name,
      expectedKmPerLiter: data.expectedKmPerLiter,
      isActive: data.isActive,
    },
  });
}

/**
 * Eliminar un tipo de vehículo.
 * Solo permite eliminar si no tiene vehículos asociados.
 */
export async function deleteVehicleType(id: number) {
  const vehicleType = await getVehicleTypeById(id);

  // Verificar que no tiene vehículos asociados
  if (vehicleType._count.vehicles > 0) {
    throw Conflict(
      `No se puede eliminar: hay ${vehicleType._count.vehicles} vehículo(s) asociados a este tipo`
    );
  }

  return prisma.vehicleType.delete({
    where: { id },
  });
}
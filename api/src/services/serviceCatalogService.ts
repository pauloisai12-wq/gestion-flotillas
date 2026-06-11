// api/src/services/serviceCatalogService.ts
// CRUD para el catálogo de servicios de mantenimiento por tipo de vehículo.

import prisma from '../lib/prisma';
import { ServiceCatalogInput } from '../validators/serviceCatalogValidator';
import { NotFound, Conflict } from '../middlewares/errorHandler';

/**
 * Obtener todos los servicios, opcionalmente filtrados por tipo de vehículo.
 */
export async function getAll(vehicleTypeId?: number) {
  const where: any = {};
  if (vehicleTypeId) where.vehicleTypeId = vehicleTypeId;

  return prisma.serviceCatalog.findMany({
    where,
    orderBy: [
      { vehicleTypeId: 'asc' },
      { intervalKm: 'asc' },
    ],
    include: {
      vehicleType: {
        select: { id: true, name: true },
      },
    },
    // Tope de seguridad (catálogo acotado); mismo criterio que workshop/sector.
    take: 500,
  });
}

/**
 * Obtener un servicio por ID.
 */
export async function getById(id: number) {
  return prisma.serviceCatalog.findUnique({
    where: { id },
    include: {
      vehicleType: {
        select: { id: true, name: true },
      },
    },
  });
}

/**
 * Crear un nuevo servicio en el catálogo.
 */
export async function create(data: ServiceCatalogInput) {
  // Verificar que el tipo de vehículo existe
  const vehicleType = await prisma.vehicleType.findUnique({
    where: { id: data.vehicleTypeId },
  });
  if (!vehicleType) throw NotFound('Tipo de vehículo');

  // Verificar que no exista un servicio con el mismo nombre para ese tipo
  const existing = await prisma.serviceCatalog.findFirst({
    where: {
      vehicleTypeId: data.vehicleTypeId,
      name: data.name,
    },
  });
  if (existing) {
    throw Conflict(
      'Ya existe el servicio "' + data.name +
      '" para ' + vehicleType.name
    );
  }

  return prisma.serviceCatalog.create({
    data: {
      vehicleTypeId: data.vehicleTypeId,
      name: data.name,
      intervalKm: data.intervalKm,
      description: data.description || null,
    },
    include: {
      vehicleType: { select: { id: true, name: true } },
    },
  });
}

/**
 * Actualizar un servicio existente.
 */
export async function update(id: number, data: ServiceCatalogInput) {
  const existing = await prisma.serviceCatalog.findUnique({ where: { id } });
  if (!existing) throw NotFound('Servicio');

  return prisma.serviceCatalog.update({
    where: { id },
    data: {
      vehicleTypeId: data.vehicleTypeId,
      name: data.name,
      intervalKm: data.intervalKm,
      description: data.description || null,
    },
    include: {
      vehicleType: { select: { id: true, name: true } },
    },
  });
}

/**
 * Eliminar un servicio del catálogo.
 * No se puede eliminar si tiene registros de mantenimiento asociados.
 */
export async function remove(id: number) {
  const service = await prisma.serviceCatalog.findUnique({
    where: { id },
    include: { _count: { select: { maintenanceRecords: true } } },
  });

  if (!service) throw NotFound('Servicio');

  if (service._count.maintenanceRecords > 0) {
    throw Conflict(
      'No se puede eliminar: tiene ' + service._count.maintenanceRecords +
      ' registro(s) de mantenimiento asociados'
    );
  }

  return prisma.serviceCatalog.delete({ where: { id } });
}
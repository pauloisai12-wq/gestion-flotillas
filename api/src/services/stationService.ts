// /api/src/services/stationService.ts
// Servicio de gasolineras v2 — con campos fiscales completos

import prisma from '../lib/prisma';
import { StationInput } from '../validators/stationValidator';
import { AppError } from '../middlewares/errorHandler';

export async function getAllStations() {
  return prisma.approvedStation.findMany({
    orderBy: { legalName: 'asc' },
    include: { _count: { select: { fuelLoads: true } } },
    // Tope de seguridad (catálogo acotado); mismo criterio que workshop/sector.
    take: 500,
  });
}

export async function getStationById(id: number) {
  const station = await prisma.approvedStation.findUnique({
    where: { id },
    include: { _count: { select: { fuelLoads: true } } },
  });
  if (!station) throw new AppError(404, 'Gasolinera no encontrada', 'NOT_FOUND');
  return station;
}

export async function createStation(data: StationInput) {
  return prisma.approvedStation.create({ data: { ...data, isActive: data.isActive ?? true } });
}

export async function updateStation(id: number, data: Partial<StationInput>) {
  await getStationById(id);
  return prisma.approvedStation.update({ where: { id }, data });
}

export async function deleteStation(id: number) {
  const station = await getStationById(id);
  if (station._count.fuelLoads > 0) {
    // Soft delete en lugar de borrar si hay cargas asociadas
    return prisma.approvedStation.update({ where: { id }, data: { isActive: false } });
  }
  return prisma.approvedStation.delete({ where: { id } });
}

// api/src/services/maintenanceService.ts
// Lógica de mantenimiento preventivo.
// Calcula próximos servicios y genera alertas basadas en kilometraje.

import prisma from '../lib/prisma';

interface UpcomingService {
  serviceId: number;
  name: string;
  intervalKm: number;
  lastMaintenanceKm: number | null;
  lastMaintenanceDate: string | null;
  nextServiceKm: number;
  currentOdometer: number;
  progressPercent: number; // 0-100+, qué porcentaje del intervalo se ha recorrido
  status: 'OK' | 'WARNING' | 'OVERDUE'; // verde, amarillo (>=80%), rojo (>=100%)
  remainingKm: number; // km que faltan (negativo si está vencido)
}

/**
 * Calcula los próximos servicios para UN vehículo.
 * Para cada servicio del catálogo de su tipo, busca el último mantenimiento
 * y calcula cuánto falta para el próximo.
 */
export async function getUpcomingServices(vehicleId: number): Promise<UpcomingService[]> {
  // Obtener el vehículo con su tipo
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      currentOdometer: true,
      vehicleTypeId: true,
    },
  });

  if (!vehicle) throw new Error('Vehículo no encontrado');

  // Obtener servicios del catálogo para ese tipo de vehículo
  const catalogServices = await prisma.serviceCatalog.findMany({
    where: { vehicleTypeId: vehicle.vehicleTypeId },
    orderBy: { intervalKm: 'asc' },
  });

  const results: UpcomingService[] = [];

  for (const service of catalogServices) {
    // Buscar el último mantenimiento de este servicio para este vehículo
    const lastMaintenance = await prisma.maintenanceRecord.findFirst({
      where: {
        vehicleId,
        serviceId: service.id,
      },
      orderBy: { serviceDate: 'desc' },
      select: {
        odometer: true,
        serviceDate: true,
      },
    });

    const lastKm = lastMaintenance?.odometer ?? 0;
    const lastDate = lastMaintenance
      ? lastMaintenance.serviceDate.toISOString()
      : null;

    // Próximo servicio = último km + intervalo
    const nextServiceKm = lastKm + service.intervalKm;

    // Km recorridos desde el último servicio
    const kmSinceLast = vehicle.currentOdometer - lastKm;

    // Progreso: qué porcentaje del intervalo se ha recorrido
    const progressPercent = Math.round((kmSinceLast / service.intervalKm) * 100);

    // Km restantes (negativo = vencido)
    const remainingKm = nextServiceKm - vehicle.currentOdometer;

    // Estado
    let status: 'OK' | 'WARNING' | 'OVERDUE';
    if (progressPercent >= 100) {
      status = 'OVERDUE';
    } else if (progressPercent >= 80) {
      status = 'WARNING';
    } else {
      status = 'OK';
    }

    results.push({
      serviceId: service.id,
      name: service.name,
      intervalKm: service.intervalKm,
      lastMaintenanceKm: lastMaintenance ? lastKm : null,
      lastMaintenanceDate: lastDate,
      nextServiceKm,
      currentOdometer: vehicle.currentOdometer,
      progressPercent,
      status,
      remainingKm,
    });
  }

  // Ordenar por urgencia: primero los vencidos, luego los más cercanos
  results.sort((a, b) => a.remainingKm - b.remainingKm);

  return results;
}

/**
 * Revisa TODOS los vehículos y retorna los servicios que están en WARNING o OVERDUE.
 * Útil para el dashboard y para el job de alertas.
 */
export async function getAllPendingServices() {
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: {
      id: true,
      plate: true,
      economicNumber: true,
      currentOdometer: true,
      vehicleTypeId: true,
    },
  });

  const allPending: Array<UpcomingService & { vehicleId: number; plate: string; economicNumber: string }> = [];

  for (const vehicle of vehicles) {
    const services = await getUpcomingServices(vehicle.id);

    for (const s of services) {
      if (s.status === 'WARNING' || s.status === 'OVERDUE') {
        allPending.push({
          ...s,
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          economicNumber: vehicle.economicNumber,
        });
      }
    }
  }

  // Ordenar por urgencia global
  allPending.sort((a, b) => a.remainingKm - b.remainingKm);

  return allPending;
}
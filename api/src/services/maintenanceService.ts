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
 * Revisa TODOS los vehículos y retorna los servicios en WARNING u OVERDUE.
 * Útil para el dashboard y para el job de alertas.
 *
 * Implementación en una sola query (LATERAL JOIN para el último
 * mantenimiento por par vehículo×servicio), en vez del antiguo N×M de
 * llamar getUpcomingServices() por cada vehículo.
 */
export async function getAllPendingServices() {
  type Row = {
    vehicle_id: number;
    plate: string;
    economic_number: string;
    current_odometer: number;
    service_id: number;
    service_name: string;
    interval_km: number;
    last_km: number | null;
    last_date: Date | null;
  };

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      v.id AS vehicle_id,
      v.plate,
      v."economicNumber" AS economic_number,
      v."currentOdometer" AS current_odometer,
      sc.id AS service_id,
      sc.name AS service_name,
      sc."intervalKm" AS interval_km,
      mr.odometer AS last_km,
      mr."serviceDate" AS last_date
    FROM vehicles v
    JOIN service_catalog sc ON sc."vehicleTypeId" = v."vehicleTypeId"
    LEFT JOIN LATERAL (
      SELECT odometer, "serviceDate"
      FROM maintenance_records
      WHERE "vehicleId" = v.id AND "serviceId" = sc.id
      ORDER BY "serviceDate" DESC
      LIMIT 1
    ) mr ON true
    WHERE v."isActive" = true
  `;

  const allPending: Array<
    UpcomingService & { vehicleId: number; plate: string; economicNumber: string }
  > = [];

  for (const row of rows) {
    const lastKm = row.last_km ?? 0;
    const kmSinceLast = row.current_odometer - lastKm;
    const progressPercent = Math.round((kmSinceLast / row.interval_km) * 100);
    if (progressPercent < 80) continue; // descartamos los OK aquí mismo

    const nextServiceKm = lastKm + row.interval_km;
    const remainingKm = nextServiceKm - row.current_odometer;
    const status: 'WARNING' | 'OVERDUE' = progressPercent >= 100 ? 'OVERDUE' : 'WARNING';

    allPending.push({
      vehicleId: row.vehicle_id,
      plate: row.plate,
      economicNumber: row.economic_number,
      serviceId: row.service_id,
      name: row.service_name,
      intervalKm: row.interval_km,
      lastMaintenanceKm: row.last_km,
      lastMaintenanceDate: row.last_date ? row.last_date.toISOString() : null,
      nextServiceKm,
      currentOdometer: row.current_odometer,
      progressPercent,
      status,
      remainingKm,
    });
  }

  allPending.sort((a, b) => a.remainingKm - b.remainingKm);
  return allPending;
}
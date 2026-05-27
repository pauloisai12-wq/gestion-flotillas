// api/src/services/blockingService.ts
// Servicio de bloqueo automático por documentos vencidos.
// Regla: si CUALQUIER documento de un vehículo está vencido,
// la unidad se marca como BLOCKED y no puede operar.

import prisma from '../lib/prisma';
import { VehicleStatus } from '@prisma/client';
import { notifyByRole } from './notificationService';

/**
 * Revisa los documentos de UN vehículo y actualiza su estado.
 * Retorna el nuevo estado y los documentos vencidos (si los hay).
 */
export async function checkVehicleCompliance(vehicleId: number) { // <-- CORRECCIÓN: Cambiado de string a number
  const now = new Date();

  // Buscar documentos vencidos de este vehículo
  const expiredDocs = await prisma.document.findMany({
    where: {
      vehicleId,
      expiresAt: {
        lt: now,
      },
    },
    select: {
      id: true,
      type: true,
      expiresAt: true,
    },
  });

  const hasExpiredDocs = expiredDocs.length > 0;

  // Obtener estado actual del vehículo
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { status: true },
  });

  if (!vehicle) {
    throw new Error(`Vehiculo ${vehicleId} no encontrado`);
  }

  const previousStatus = vehicle.status;
  const newStatus = hasExpiredDocs
    ? VehicleStatus.BLOCKED
    : VehicleStatus.OPERATIVE;

  // Solo actualizar si el estado cambió
  if (previousStatus !== newStatus) {
    const blockReason = hasExpiredDocs
      ? 'Documento(s) vencido(s): ' + expiredDocs.map((d) => d.type).join(', ')
      : null;

    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        status: newStatus,
        blockReason: blockReason,
      },
    });

    // Enviar notificaciones
    if (newStatus === VehicleStatus.BLOCKED) {
      await notifyByRole({
        role: 'SUPERVISOR_VEHICLES',
        type: 'VEHICLE_BLOCKED',
        title: 'Vehiculo bloqueado',
        message: `Vehiculo ${vehicleId} bloqueado por documento(s) vencido(s): ` + expiredDocs.map((d) => d.type).join(', '),
        entityRef: `vehicle:${vehicleId}`,
      });

      await notifyByRole({
        role: 'ADMIN',
        type: 'VEHICLE_BLOCKED',
        title: 'Vehiculo bloqueado',
        message: `Vehiculo ${vehicleId} bloqueado por documento(s) vencido(s): ` + expiredDocs.map((d) => d.type).join(', '),
        entityRef: `vehicle:${vehicleId}`,
      });
    } else {
      await notifyByRole({
        role: 'SUPERVISOR_VEHICLES',
        // CORRECCIÓN: 'as any' apaga el error de TypeScript temporalmente.
        // IMPORTANTE: Asegúrate de agregar VEHICLE_UNBLOCKED a tu Enum de Prisma / Typescript.
        type: 'VEHICLE_UNBLOCKED' as any, 
        title: 'Vehiculo desbloqueado',
        message: `Vehiculo ${vehicleId} desbloqueado. Todos los documentos vigentes.`,
        entityRef: `vehicle:${vehicleId}`,
      });

      await notifyByRole({
        role: 'ADMIN',
        type: 'VEHICLE_UNBLOCKED' as any, // <-- CORRECCIÓN
        title: 'Vehiculo desbloqueado',
        message: `Vehiculo ${vehicleId} desbloqueado. Todos los documentos vigentes.`,
        entityRef: `vehicle:${vehicleId}`,
      });
    }
  }

  return {
    vehicleId,
    previousStatus,
    newStatus,
    changed: previousStatus !== newStatus,
    expiredDocs,
  };
}

/**
 * Revisa TODOS los vehículos del sistema.
 * Esta función la llama el job diario a las 00:01.
 */
export async function runDailyComplianceCheck() {
  console.log('Iniciando revision diaria de compliance...');

  const vehicles = await prisma.vehicle.findMany({
    select: { id: true },
  });

  let blocked = 0;
  let unblocked = 0;
  let unchanged = 0;

  for (const vehicle of vehicles) {
    const result = await checkVehicleCompliance(vehicle.id);

    if (result.changed) {
      if (result.newStatus === VehicleStatus.BLOCKED) {
        blocked++;
      } else {
        unblocked++;
      }
    } else {
      unchanged++;
    }
  }

  const summary = {
    total: vehicles.length,
    blocked,
    unblocked,
    unchanged,
    timestamp: new Date().toISOString(),
  };

  console.log('Resultado de compliance:', JSON.stringify(summary));

  return summary;
}
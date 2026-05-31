// api/src/services/blockingService.ts
// Servicio de bloqueo automático por documentos vencidos.
// Regla: si CUALQUIER documento de un vehículo está vencido,
// la unidad se marca como BLOCKED y no puede operar.

import prisma from '../lib/prisma';
import { VehicleStatus } from '@prisma/client';
import { notifyByRole } from './notificationService';
import { AppError } from '../middlewares/errorHandler';

/**
 * Revisa los documentos de UN vehículo y actualiza su estado.
 * Retorna el nuevo estado y los documentos vencidos (si los hay).
 */
export async function checkVehicleCompliance(vehicleId: number) { // <-- CORRECCIÓN: Cambiado de string a number
  // "Vencido" = expiresAt ANTES del inicio del día de hoy (consistente con el
  // semáforo de documentService: un documento que vence HOY todavía NO bloquea).
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Buscar documentos vencidos de este vehículo
  const expiredDocs = await prisma.document.findMany({
    where: {
      vehicleId,
      expiresAt: {
        lt: startOfToday,
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
    throw new AppError(404, `Vehiculo ${vehicleId} no encontrado`, 'NOT_FOUND');
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
        type: 'VEHICLE_UNBLOCKED',
        title: 'Vehiculo desbloqueado',
        message: `Vehiculo ${vehicleId} desbloqueado. Todos los documentos vigentes.`,
        entityRef: `vehicle:${vehicleId}`,
      });

      await notifyByRole({
        role: 'ADMIN',
        type: 'VEHICLE_UNBLOCKED',
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
 * Revisa TODOS los vehículos del sistema en lote.
 * Esta función la llama el job diario a las 00:01.
 *
 * Implementación en 3 queries (independiente del nº de vehículos), en vez del
 * antiguo loop N+1 que disparaba 3-4 queries por vehículo.
 */
export async function runDailyComplianceCheck() {
  console.log('Iniciando revision diaria de compliance...');
  const now = new Date();
  // "Vencido" = expiresAt ANTES del inicio del día de hoy (mismo criterio que
  // checkVehicleCompliance y el semáforo: vencer HOY todavía NO bloquea).
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // 1) Una query agregada: vehículo + estado actual + si tiene algún doc vencido.
  const rows = await prisma.$queryRaw<
    Array<{ id: number; status: VehicleStatus; has_expired: boolean }>
  >`
    SELECT v.id, v.status, EXISTS (
      SELECT 1 FROM documents d
      WHERE d."vehicleId" = v.id AND d."expiresAt" < ${startOfToday}
    ) AS has_expired
    FROM vehicles v
    WHERE v."isActive" = true
  `;

  const toBlock: number[] = [];
  const toUnblock: number[] = [];
  for (const r of rows) {
    if (r.has_expired && r.status !== VehicleStatus.BLOCKED) toBlock.push(r.id);
    else if (!r.has_expired && r.status === VehicleStatus.BLOCKED) toUnblock.push(r.id);
  }

  // 2) Aplicar bloqueos y desbloqueos en transacción.
  if (toBlock.length > 0 || toUnblock.length > 0) {
    await prisma.$transaction([
      ...(toBlock.length > 0
        ? [
            prisma.vehicle.updateMany({
              where: { id: { in: toBlock } },
              data: { status: VehicleStatus.BLOCKED, blockReason: 'Documento(s) vencido(s)' },
            }),
          ]
        : []),
      ...(toUnblock.length > 0
        ? [
            prisma.vehicle.updateMany({
              where: { id: { in: toUnblock } },
              data: { status: VehicleStatus.OPERATIVE, blockReason: null },
            }),
          ]
        : []),
    ]);
  }

  // 3) Notificar solo los cambios reales (suele ser 0-5 por día, no N).
  for (const vehicleId of toBlock) {
    await notifyByRole({
      role: 'SUPERVISOR_VEHICLES',
      type: 'VEHICLE_BLOCKED',
      title: 'Vehiculo bloqueado',
      message: `Vehiculo ${vehicleId} bloqueado por documento(s) vencido(s).`,
      entityRef: `vehicle:${vehicleId}`,
    });
    await notifyByRole({
      role: 'ADMIN',
      type: 'VEHICLE_BLOCKED',
      title: 'Vehiculo bloqueado',
      message: `Vehiculo ${vehicleId} bloqueado por documento(s) vencido(s).`,
      entityRef: `vehicle:${vehicleId}`,
    });
  }
  for (const vehicleId of toUnblock) {
    await notifyByRole({
      role: 'SUPERVISOR_VEHICLES',
      type: 'VEHICLE_UNBLOCKED',
      title: 'Vehiculo desbloqueado',
      message: `Vehiculo ${vehicleId} desbloqueado. Todos los documentos vigentes.`,
      entityRef: `vehicle:${vehicleId}`,
    });
    await notifyByRole({
      role: 'ADMIN',
      type: 'VEHICLE_UNBLOCKED',
      title: 'Vehiculo desbloqueado',
      message: `Vehiculo ${vehicleId} desbloqueado. Todos los documentos vigentes.`,
      entityRef: `vehicle:${vehicleId}`,
    });
  }

  const summary = {
    total: rows.length,
    blocked: toBlock.length,
    unblocked: toUnblock.length,
    unchanged: rows.length - toBlock.length - toUnblock.length,
    timestamp: now.toISOString(),
  };

  console.log('Resultado de compliance:', JSON.stringify(summary));

  return summary;
}
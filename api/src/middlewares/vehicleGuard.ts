// api/src/middlewares/vehicleGuard.ts
// Guard que impide operaciones sobre vehículos bloqueados.
// Se usa en endpoints de cargas de combustible, asignaciones, etc.
// Busca el vehicleId en req.body o req.params.

import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { VehicleStatus } from '@prisma/client';

export async function checkVehicleOperable(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Buscar vehicleId en body (POST) o en params (rutas como /vehicles/:vehicleId/...)
  const vehicleId = req.body.vehicleId || req.params.vehicleId;
console.log('🛡️ GUARD - vehicleId:', vehicleId, 'tipo:', typeof vehicleId);

  if (!vehicleId) {
    // Si no hay vehicleId en la petición, dejar pasar (no aplica este guard)
    next();
    return;
  }

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        status: true,
        economicNumber: true,
        plate: true,
      },
    });

    if (!vehicle) {
      res.status(404).json({
        error: 'Vehículo no encontrado',
      });
      return;
    }

    if (vehicle.status === VehicleStatus.BLOCKED) {
      // Buscar qué documentos están vencidos para dar un mensaje claro
      const expiredDocs = await prisma.document.findMany({
        where: {
          vehicleId,
          expiresAt: { lt: new Date() },
        },
        select: { type: true, expiresAt: true },
      });

      const docTypes = expiredDocs.map((d) => d.type).join(', ');

      res.status(403).json({
        error: 'Unidad bloqueada por documento(s) vencido(s)',
        details: {
          vehicleId,
          plate: vehicle.plate,
          economicNumber: vehicle.economicNumber,
          expiredDocuments: docTypes,
          message:
            'Esta unidad no puede operar hasta que se renueven los documentos vencidos.',
        },
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Error en vehicleGuard:', error);
    res.status(500).json({ error: 'Error al verificar estado del vehículo' });
  }
}
// Instancia centralizada de PrismaClient con extensión de auditoría
// Prisma 6 usa $extends (el antiguo $use fue removido)

import { PrismaClient } from '@prisma/client';
import type { ITXClientDenyList } from '@prisma/client/runtime/library';
import { getAuditContext } from './auditContext';

const AUDITED_MODELS = new Set([
  'Vehicle',
  'VehicleBudget',
  'MonthlyBudget',
  'User',
  'FuelLoad',
  'ApprovedStation',
  'Workshop',
  'Sector',
  'VehicleNote',
  'Document',
]);

const AUDITED_OPS = new Set(['create', 'update', 'delete', 'upsert']);

const basePrisma = new PrismaClient();

const prisma = basePrisma.$extends({
  name: 'audit-log',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const shouldAudit = AUDITED_MODELS.has(model ?? '') && AUDITED_OPS.has(operation);
        const result = await query(args);

        if (shouldAudit) {
          const ctx = getAuditContext();
          try {
            await basePrisma.auditLog.create({
              data: {
                userId: ctx?.userId,
                action: operation.toUpperCase(),
                resource: model!,
                resourceId:
                  String(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (result as any)?.id ??
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (args as any)?.where?.id ??
                      '',
                  ) || null,
                after: ['create', 'update', 'upsert'].includes(operation)
                  ? (result as object)
                  : undefined,
                ipAddress: ctx?.ipAddress,
                userAgent: ctx?.userAgent,
                requestId: ctx?.requestId,
              },
            });
          } catch {
            // Si el audit falla NO debe romper la operación principal
          }
        }

        return result;
      },
    },
  },
});

/**
 * Tipo del cliente dentro de `prisma.$transaction(async (tx) => ...)`.
 * Necesario porque al usar `$extends`, `Prisma.TransactionClient` ya no es
 * asignable: el `tx` real es el cliente extendido sin los métodos top-level
 * de gestión de transacción/conexión (los del deny list).
 */
export type Tx = Omit<typeof prisma, ITXClientDenyList>;

export default prisma;

// api/src/validators/budgetValidator.ts
// Validadores v2 — presupuestos unificados (FUEL|MAINTENANCE) con rollover

import { z } from 'zod/v4';

const monthYear = {
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2024).max(2035),
};

const kind = z.enum(['FUEL', 'MAINTENANCE']);

/** Asignar baseAmount a un vehículo en un periodo */
export const assignBudgetSchema = z.object({
  vehicleId: z.number().int().positive(),
  kind,
  ...monthYear,
  baseAmount: z.number().min(0),
});

/** Asignación masiva: distribuir presupuesto a N vehículos */
export const distributeBudgetSchema = z.object({
  kind,
  ...monthYear,
  distributions: z
    .array(
      z.object({
        vehicleId: z.number().int().positive(),
        baseAmount: z.number().min(0),
      }),
    )
    .min(1),
});

/** Cerrar mes y aplicar rollover (idempotente) */
export const closeMonthSchema = z.object({
  ...monthYear,
  kind: kind.optional(), // si no se pasa, cierra ambos
});

/** Query filtros de listado */
export const listBudgetsQuerySchema = z.object({
  kind: kind.optional(),
  year: z.coerce.number().int().min(2024).max(2035).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
});

export type AssignBudgetInput = z.infer<typeof assignBudgetSchema>;
export type DistributeBudgetInput = z.infer<typeof distributeBudgetSchema>;
export type CloseMonthInput = z.infer<typeof closeMonthSchema>;

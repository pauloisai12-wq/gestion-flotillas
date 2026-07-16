// api/src/validators/budgetValidator.ts
// Validadores v2 — presupuestos unificados (FUEL|MAINTENANCE) con rollover

import { z } from 'zod/v4';

const monthYear = {
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2024).max(2035),
};

const kind = z.enum(['FUEL', 'MAINTENANCE']);
const classification = z.enum(['POLICIAL', 'ESTATAL', 'VIAL']);
export const MAX_BUDGET_DISTRIBUTIONS = 5_000;

function money(max: number) {
  return z.number().finite().min(0).max(max).refine(
    (value) => {
      const cents = Math.round(value * 100);
      return Number.isSafeInteger(cents) && Math.abs(cents / 100 - value) <= 1e-9;
    },
    { message: 'El monto debe tener como máximo dos decimales' },
  );
}

const vehicleBudgetAmount = money(9_999_999_999.99); // Decimal(12,2)
const monthlyPoolAmount = money(999_999_999_999.99); // Decimal(14,2)

/** Asignar baseAmount a un vehículo en un periodo */
export const assignBudgetSchema = z.object({
  vehicleId: z.number().int().positive(),
  kind,
  ...monthYear,
  baseAmount: vehicleBudgetAmount,
});

/** Asignación masiva: distribuir presupuesto a N vehículos */
export const distributeBudgetSchema = z.object({
  kind,
  ...monthYear,
  distributions: z
    .array(
      z.object({
        vehicleId: z.number().int().positive(),
        baseAmount: vehicleBudgetAmount,
      }),
    )
    .min(1)
    .max(MAX_BUDGET_DISTRIBUTIONS, `No se pueden distribuir más de ${MAX_BUDGET_DISTRIBUTIONS} unidades por operación`),
});

/** Destinatarios resueltos exclusivamente por backend para la distribución masiva. */
export const budgetDistributionTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ALL') }),
  z.object({ mode: z.literal('UNASSIGNED') }),
  z.object({ mode: z.literal('CLASSIFICATION'), classification }),
]);

export const distributeTargetBudgetSchema = z.object({
  kind,
  ...monthYear,
  target: budgetDistributionTargetSchema,
  allocation: z.object({
    mode: z.enum(['TOTAL', 'PER_UNIT']),
    amount: vehicleBudgetAmount,
  }),
});

export const distributionTargetsQuerySchema = z.object({
  kind,
  year: z.coerce.number().int().min(2024).max(2035),
  month: z.coerce.number().int().min(1).max(12),
});

/** Cerrar mes y aplicar rollover (idempotente) */
export const closeMonthSchema = z.object({
  ...monthYear,
  kind: kind.optional(), // si no se pasa, cierra ambos
});

/** Declarar/actualizar el pote mensual (PUT /monthly-pool) */
export const monthlyPoolSchema = z.object({
  kind,
  ...monthYear,
  totalAmount: monthlyPoolAmount,
  notes: z.string().max(500).optional().nullable(),
});

/** Query filtros de listado */
export const listBudgetsQuerySchema = z.object({
  kind: kind.optional(),
  year: z.coerce.number().int().min(2024).max(2035).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type AssignBudgetInput = z.infer<typeof assignBudgetSchema>;
export type DistributeBudgetInput = z.infer<typeof distributeBudgetSchema>;
export type BudgetDistributionTarget = z.infer<typeof budgetDistributionTargetSchema>;
export type DistributeTargetBudgetInput = z.infer<typeof distributeTargetBudgetSchema>;
export type DistributionTargetsQuery = z.infer<typeof distributionTargetsQuerySchema>;
export type CloseMonthInput = z.infer<typeof closeMonthSchema>;
export type MonthlyPoolInput = z.infer<typeof monthlyPoolSchema>;

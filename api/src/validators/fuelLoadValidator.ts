// Validación de cargas — v2 con odómetro NF + operador texto libre

import { z } from 'zod/v4';

// Límite técnico de PostgreSQL NUMERIC(12,2): 10 enteros + 2 decimales.
export const MAX_FUEL_LOAD_AMOUNT = 9_999_999_999.99;

/** Schema base con refinement para odometer/NF consistency */
const baseFuelLoad = z.object({
  vehicleId: z.number().int().positive(),
  /** Operador: el nombre/número siempre como texto. Si matchea, backend liga el FK. */
  operatorEmployee: z.string().trim().min(1).max(50),
  operatorName: z.string().trim().min(1).max(150),
  stationId: z.number().int().positive(),
  liters: z.number().positive().optional().nullable(),
  amount: z.number().positive().max(MAX_FUEL_LOAD_AMOUNT),

  /** Odómetro + estado */
  odometer: z.number().min(0).optional().nullable(),
  odometerStatus: z.enum(['OK', 'NF']).default('OK'),

  loadDate: z.iso.date().optional(),
});

export const fuelLoadSchema = baseFuelLoad.refine(
  (data) => {
    if (data.odometerStatus === 'NF') return data.odometer == null;
    return data.odometer != null && data.odometer >= 0;
  },
  {
    message: 'Si odómetro=NF, no debe enviarse valor. Si OK, el valor es obligatorio.',
    path: ['odometer'],
  },
);

export type FuelLoadInput = z.infer<typeof fuelLoadSchema>;

/** Query del listado de cargas — filtros opcionales; page/limit los normaliza parsePagination. */
export const fuelLoadQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  operatorId: z.coerce.number().int().positive().optional(),
  stationId: z.coerce.number().int().positive().optional(),
  status: z.enum(['APPROVED', 'PENDING_REVIEW', 'REJECTED']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type FuelLoadQueryInput = z.infer<typeof fuelLoadQuerySchema>;

/** Schema del portal público — mismo, pero añade economicNumber (el operador teclea su unidad) */
export const publicFuelLoadSchema = baseFuelLoad
  .extend({
    vehicleEconomicNumber: z.string().trim().min(1).max(30),
    /** Token CSRF emitido al abrir el form */
    csrfToken: z.string().min(10),
  })
  .omit({ vehicleId: true }) // el portal lo resuelve por economicNumber
  .refine(
    (data) => {
      if (data.odometerStatus === 'NF') return data.odometer == null;
      return data.odometer != null && data.odometer >= 0;
    },
    { message: 'Odómetro inválido para el estado declarado.', path: ['odometer'] },
  );

export type PublicFuelLoadInput = z.infer<typeof publicFuelLoadSchema>;

/** Transición normal para capturas creadas con el flujo sin efectos de Sprint 1. */
export const fuelLoadReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(5).max(500),
});

export type FuelLoadReviewInput = z.infer<typeof fuelLoadReviewSchema>;

/**
 * Reconciliación excepcional de pendientes anteriores al state machine.
 * Los hechos sobre presupuesto/odómetro son declarados por un administrador
 * después de contrastarlos con BD/auditoría; el backend nunca los infiere.
 */
export const legacyFuelLoadReconciliationSchema = fuelLoadReviewSchema
  .extend({
    budgetEffect: z.enum(['APPLIED', 'NOT_APPLIED', 'NO_BUDGET']),
    odometerEffect: z.enum(['APPLIED', 'NOT_APPLIED']),
    correctedOdometer: z.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    const correctionRequired = data.decision === 'REJECT' && data.odometerEffect === 'APPLIED';
    if (correctionRequired && data.correctedOdometer == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctedOdometer'],
        message: 'El odómetro corregido es obligatorio al rechazar una carga cuyo efecto fue aplicado.',
      });
    }
    if (!correctionRequired && data.correctedOdometer != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctedOdometer'],
        message: 'El odómetro corregido solo aplica al rechazar una carga con efecto aplicado.',
      });
    }
  });

export type LegacyFuelLoadReconciliationInput = z.infer<
  typeof legacyFuelLoadReconciliationSchema
>;

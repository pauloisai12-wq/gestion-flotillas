// api/src/validators/maintenanceTicketValidator.ts
// Validaciones del flujo de tickets de mantenimiento (Admin/Ejecutor/Taller).
//
// El ejecutor no es técnico: la descripción es libre y la categoría tiene
// un default OTHER, así que nunca se le obliga a clasificar bien.

import { z } from 'zod/v4';

const failureCategoryEnum = z.enum([
  'ENGINE',
  'TRANSMISSION',
  'BRAKES',
  'ELECTRICAL',
  'BODY_PAINT',
  'TIRES_SUSPENSION',
  'AC_CLIMATE',
  'PREVENTIVE',
  'OTHER',
]);

/// ── EJECUTOR: crear ticket ────────────────────────────────────────
export const createTicketSchema = z
  .object({
    vehicleId: z.number().int().positive(),
    failureCategory: failureCategoryEnum.default('OTHER'),
    description: z.string().trim().min(10, 'Describe la falla con al menos 10 caracteres').max(2000),
    reportedOdometer: z.number().min(0).optional().nullable(),
    odometerStatus: z.enum(['OK', 'NF']).default('OK'),
  })
  .refine(
    (d) => {
      if (d.odometerStatus === 'NF') return d.reportedOdometer == null;
      // OK con odómetro null es válido (el ejecutor puede no anotarlo); lo dejamos opcional
      return true;
    },
    { message: 'Si odómetro=NF, no envíes valor numérico', path: ['reportedOdometer'] },
  );

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/// ── ADMIN: rechazo (filtro inicial o final) ───────────────────────
export const rejectTicketSchema = z.object({
  rejectionReason: z.string().trim().min(5, 'Motivo del rechazo es obligatorio').max(1000),
});

export type RejectTicketInput = z.infer<typeof rejectTicketSchema>;

/// ── ADMIN: asignar talleres (1 a 3, opcional cuántos) ─────────────
export const assignWorkshopsSchema = z
  .object({
    workshopIds: z
      .array(z.number().int().positive())
      .min(1, 'Selecciona al menos un taller')
      .max(3, 'Puedes asignar como máximo 3 talleres'),
  })
  .refine((d) => new Set(d.workshopIds).size === d.workshopIds.length, {
    message: 'Los talleres seleccionados deben ser distintos',
    path: ['workshopIds'],
  });

export type AssignWorkshopsInput = z.infer<typeof assignWorkshopsSchema>;

/// ── ADMIN: aprobar cotización ganadora ────────────────────────────
export const approveTicketSchema = z.object({
  selectedQuoteId: z.number().int().positive(),
  finalConcept: z
    .string()
    .trim()
    .min(10, 'El concepto de la reparación debe tener al menos 10 caracteres')
    .max(2000),
});

export type ApproveTicketInput = z.infer<typeof approveTicketSchema>;

/// ── TALLER: enviar cotización (amount; PDF va por multipart) ──────
export const submitQuoteSchema = z.object({
  amount: z.coerce.number().positive('El monto debe ser mayor a 0').max(99_999_999.99),
  diagnosisNotes: z.string().trim().max(2000).optional(),
});

export type SubmitQuoteInput = z.infer<typeof submitQuoteSchema>;

/// ── TALLER: declinar cotización ──────────────────────────────────
export const declineQuoteSchema = z.object({
  declineReason: z.string().trim().min(5, 'Motivo del rechazo es obligatorio').max(500),
});

export type DeclineQuoteInput = z.infer<typeof declineQuoteSchema>;

/// ── TALLER: completar reparación ──────────────────────────────────
/// Para crear el MaintenanceRecord asociado se requiere un serviceId
/// (catálogo) — el frontend lo presenta como dropdown filtrado por vehicleType.
export const completeRepairSchema = z
  .object({
    serviceId: z.number().int().positive(),
    finalOdometer: z.number().min(0).optional().nullable(),
    finalOdometerStatus: z.enum(['OK', 'NF']).default('OK'),
    evidenceNotes: z.string().trim().max(1000).optional(),
  })
  .refine(
    (d) => {
      if (d.finalOdometerStatus === 'NF') return d.finalOdometer == null;
      return true;
    },
    { message: 'Si odómetro=NF, no envíes valor numérico', path: ['finalOdometer'] },
  );

export type CompleteRepairInput = z.infer<typeof completeRepairSchema>;

/// ── Listado: filtros opcionales por estado/vehículo/fechas ────────
export const listTicketsQuerySchema = z.object({
  status: z
    .enum([
      'PENDING_ADMIN_APPROVAL',
      'REJECTED_BY_ADMIN',
      'AWAITING_QUOTES',
      'REJECTED_FINAL',
      'APPROVED_FOR_REPAIR',
      'IN_REPAIR',
      'COMPLETED',
    ])
    .optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

/// ── Revisor (ADMIN / SUP_MAINT): búsqueda por CIV / placa / serie / folio ──
/// Coincidencia: folio y CIV exactos; placa y serie parciales (ILIKE).
export const searchTicketsQuerySchema = z.object({
  civ: z.string().trim().min(1).optional(),
  placa: z.string().trim().min(1).optional(),
  serie: z.string().trim().min(1).optional(),
  folio: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SearchTicketsQuery = z.infer<typeof searchTicketsQuerySchema>;

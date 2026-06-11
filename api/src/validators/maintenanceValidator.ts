// Validaciones v2 — usa workshop FK + texto libre opcional + odómetro NF

import { z } from 'zod/v4';

export const maintenanceSchema = z
  .object({
    vehicleId: z.number().int().positive(),
    serviceId: z.number().int().positive(),
    odometer: z.number().min(0).optional().nullable(),
    odometerStatus: z.enum(['OK', 'NF']).default('OK'),
    cost: z.number().min(0),
    /** Taller del catálogo (recomendado). Si no se pasa, workshopRaw es obligatorio */
    workshopId: z.number().int().positive().optional().nullable(),
    workshopRaw: z.string().trim().max(200).optional().nullable(),
    serviceDate: z.string().min(1),
    notes: z.string().max(1000).optional(),
  })
  .refine((d) => d.workshopId != null || (d.workshopRaw && d.workshopRaw.length > 0), {
    message: 'Debe seleccionar un taller del catálogo o escribir el nombre',
    path: ['workshopId'],
  })
  .refine(
    (d) => {
      if (d.odometerStatus === 'NF') return d.odometer == null;
      return d.odometer != null && d.odometer >= 0;
    },
    { message: 'Si odómetro=NF, no se envía valor. Si OK, el valor es obligatorio.', path: ['odometer'] },
  );

export type MaintenanceInput = z.infer<typeof maintenanceSchema>;

// Listado paginado de registros: paginación + filtros opcionales
export const listMaintenanceQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vehicleId: z.coerce.number().int().positive().optional(),
  serviceId: z.coerce.number().int().positive().optional(),
});

export type ListMaintenanceQuery = z.infer<typeof listMaintenanceQuerySchema>;

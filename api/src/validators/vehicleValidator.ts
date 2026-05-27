// Archivo: /api/src/validators/vehicleValidator.ts
// Validación de vehículos — v2 con classification + sectorId

import { z } from 'zod/v4';

export const vehicleSchema = z.object({
  plate: z.string().min(5).max(15),
  economicNumber: z.string().min(1).max(20),
  vehicleTypeId: z.number().int().positive(),

  classification: z.enum(['POLICIAL', 'ESTATAL', 'VIAL']).default('ESTATAL'),
  sectorId: z.number().int().positive().optional().nullable(),

  brand: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  year: z
    .number()
    .int()
    .min(1990)
    .max(new Date().getFullYear() + 1),

  vin: z.string().max(17).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
  currentOdometer: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const vehicleUpdateSchema = vehicleSchema.partial();

export type VehicleInput = z.infer<typeof vehicleSchema>;
export type VehicleUpdateInput = z.infer<typeof vehicleUpdateSchema>;

// Archivo: /api/src/validators/vehicleNoteValidator.ts
// Validación de notas de bitácora

import { z } from 'zod/v4';

export const vehicleNoteCreateSchema = z.object({
  content: z
    .string()
    .trim()
    .min(3, 'La nota debe tener al menos 3 caracteres')
    .max(2000, 'La nota no debe exceder 2000 caracteres'),
});

export const vehicleNoteUpdateSchema = vehicleNoteCreateSchema;

export type VehicleNoteInput = z.infer<typeof vehicleNoteCreateSchema>;

// Validación de talleres — mismo contrato que gasolineras

import { z } from 'zod/v4';

const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;

export const workshopSchema = z.object({
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(rfcRegex, 'RFC inválido (formato MX)'),
  legalName: z.string().trim().min(3).max(200),
  tradeName: z.string().trim().max(100).optional().nullable(),
  email: z.string().email('Correo inválido'),
  phone: z.string().trim().regex(/^\d{7,15}$/, 'Teléfono inválido'),
  address: z.string().trim().min(5).max(300),
  isActive: z.boolean().optional(),
});

export const workshopUpdateSchema = workshopSchema.partial();

export type WorkshopInput = z.infer<typeof workshopSchema>;

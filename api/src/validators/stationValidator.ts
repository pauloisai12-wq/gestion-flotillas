// Archivo: /api/src/validators/stationValidator.ts
// Validación de gasolineras — v2 con RFC + contacto fiscal

import { z } from 'zod/v4';

/** RFC persona moral (12) o física (13). Acepta mayúsculas y dígitos. */
const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;

export const stationSchema = z.object({
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(rfcRegex, 'RFC inválido (formato MX: 3-4 letras + 6 dígitos + 3 alfanuméricos)'),
  legalName: z.string().trim().min(3).max(200),
  tradeName: z.string().trim().max(100).optional().nullable(),
  email: z.string().email('Correo inválido'),
  phone: z
    .string()
    .trim()
    .regex(/^\d{7,15}$/, 'Teléfono inválido (7-15 dígitos)'),
  address: z.string().trim().min(5).max(300),
  isActive: z.boolean().optional(),
});

export const stationUpdateSchema = stationSchema.partial();

export type StationInput = z.infer<typeof stationSchema>;

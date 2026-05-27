// Validación de operadores v2 — con employeeNumber obligatorio
import { z } from 'zod/v4';

export const operatorSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(30),
  fullName: z.string().trim().min(3).max(100),
  licenseNumber: z.string().trim().min(3).max(30),
  licenseType: z.string().trim().min(1).max(5),
  licenseExpiresAt: z.string().min(1),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().email().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const operatorUpdateSchema = operatorSchema.partial();

export type OperatorInput = z.infer<typeof operatorSchema>;

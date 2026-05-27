import { z } from 'zod/v4';

export const sectorSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9\-_]+$/, 'Código inválido (solo mayúsculas, números, - o _)'),
  name: z.string().trim().min(2).max(100),
  isActive: z.boolean().optional(),
});

export const sectorUpdateSchema = sectorSchema.partial();

export type SectorInput = z.infer<typeof sectorSchema>;

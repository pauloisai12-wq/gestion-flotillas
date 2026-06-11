// Validación para generación de reportes

import { z } from 'zod/v4';

// Schema para solicitar generación de reporte
export const generateReportSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
});

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
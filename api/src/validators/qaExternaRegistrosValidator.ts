// Validación del listado de registros qa_externa (lado REVISOR_QA).
// page/limit los normaliza parsePagination; el resto son filtros opcionales.

import { z } from 'zod/v4';

export const qaRegistrosQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  tipo: z.enum(['lona', 'reunion', 'barda', 'otro']).optional(),
  programa: z.enum(['BUFFALO', 'LX']).optional(),
  dispositivo: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type QaRegistrosQueryInput = z.infer<typeof qaRegistrosQuerySchema>;

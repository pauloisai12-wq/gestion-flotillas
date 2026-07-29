// Validación del listado de registros qa_externa (lado REVISOR_QA).
// page/limit los normaliza parsePagination; el resto son filtros opcionales.

import { z } from 'zod/v4';

/**
 * Fecha civil AAAA-MM-DD. Se declara arriba porque también la usan los filtros
 * del listado: sin el formato acotado, una cadena basura llegaba tal cual al
 * `new Date()` del servicio y producía un Date inválido dentro del where.
 * La comparte el listado de personas (qaExternaPersonasValidator.ts).
 */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa formato AAAA-MM-DD');

export const qaRegistrosQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  tipo: z.enum(['lona', 'reunion', 'barda', 'otro']).optional(),
  programa: z.enum(['BUFFALO', 'LX']).optional(),
  dispositivo: z.coerce.number().int().positive().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export type QaRegistrosQueryInput = z.infer<typeof qaRegistrosQuerySchema>;

export const qaExportQuerySchema = z
  .object({
    programa: z.enum(['BUFFALO', 'LX']),
    dateFrom: isoDate,
    dateTo: isoDate,
  })
  .superRefine((value, ctx) => {
    const from = new Date(`${value.dateFrom}T00:00:00.000Z`);
    const to = new Date(`${value.dateTo}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'dateTo debe ser igual o posterior a dateFrom',
      });
      return;
    }
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 366) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'El rango máximo de exportación es 366 días',
      });
    }
  });

export type QaExportQueryInput = z.infer<typeof qaExportQuerySchema>;

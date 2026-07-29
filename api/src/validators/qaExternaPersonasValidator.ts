// Validación de la lectura del "registro de personas" (lado REVISOR_QA):
// listado paginado y exportación CSV. Es la cara JWT, así que usa `zod/v4` +
// validateQuery, NO el subpath plano con safeParse manual de la cara de
// dispositivo (qaExternaPersonaValidator.ts). Los dos conviven a propósito.
//
// page/limit se aceptan aquí solo para que no los rechace el schema: quien los
// normaliza (mínimos, tope) es parsePagination.

import { z } from 'zod/v4';
import { isoDate } from './qaExternaRegistrosValidator';

export const qaPersonasQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  programa: z.enum(['BUFFALO', 'LX']).optional(),
  dispositivo: z.coerce.number().int().positive().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  // Búsqueda libre sobre nombre y teléfono. El tope evita armar un LIKE enorme.
  q: z.string().trim().max(100, 'La búsqueda no puede exceder 100 caracteres').optional(),
});

export type QaPersonasQueryInput = z.infer<typeof qaPersonasQuerySchema>;

// La exportación exige rango: sin él es demasiado fácil pedir el histórico
// completo de un tirón. El tope de filas lo aplica además el servicio.
//
// El .superRefine repite la validación de rango de qaExportQuerySchema
// (qaExternaRegistrosValidator.ts) a propósito: extraerla obligaría a reescribir
// ese schema, que hoy está en uso por la exportación ZIP y queda fuera del
// alcance de este cambio. Si algún día se toca aquel archivo, unificar las dos.
export const qaPersonasExportQuerySchema = z
  .object({
    programa: z.enum(['BUFFALO', 'LX']).optional(),
    dispositivo: z.coerce.number().int().positive().optional(),
    q: z.string().trim().max(100, 'La búsqueda no puede exceder 100 caracteres').optional(),
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

export type QaPersonasExportQueryInput = z.infer<typeof qaPersonasExportQuerySchema>;

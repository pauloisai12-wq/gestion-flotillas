// Validaciones para el catálogo de servicios de mantenimiento

import { z } from 'zod/v4';

export const serviceCatalogSchema = z.object({
  vehicleTypeId: z.number().int().positive('Debe seleccionar un tipo de vehículo'),
  name: z.string().min(2, 'Mínimo 2 caracteres').max(100, 'Máximo 100 caracteres'),
  intervalKm: z.number().int().positive('El intervalo debe ser mayor a 0'),
  description: z.string().max(500).optional(),
});

export type ServiceCatalogInput = z.infer<typeof serviceCatalogSchema>;

/** Query de listado: filtro opcional por tipo de vehículo. */
export const serviceCatalogQuerySchema = z.object({
  vehicleTypeId: z.coerce.number().int().positive().optional(),
});

export type ServiceCatalogQuery = z.infer<typeof serviceCatalogQuerySchema>;
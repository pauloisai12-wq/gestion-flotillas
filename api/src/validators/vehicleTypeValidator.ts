// Archivo: /flotillas/api/src/validators/vehicleTypeValidator.ts
// NUEVO: Validación de datos de entrada para tipos de vehículo
import { z } from 'zod/v4';

// Esquema que valida los datos al crear o editar un tipo de vehículo
export const vehicleTypeSchema = z.object({
  // Nombre obligatorio, mínimo 2 caracteres, máximo 100
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no debe exceder 100 caracteres'),

  // Rendimiento esperado: número positivo
  expectedKmPerLiter: z
    .number()
    .positive('El rendimiento debe ser mayor a 0'),

  // Activo/inactivo: opcional, por defecto true
  isActive: z.boolean().optional(),
});

// Tipo TypeScript generado automáticamente desde el esquema Zod
export type VehicleTypeInput = z.infer<typeof vehicleTypeSchema>;
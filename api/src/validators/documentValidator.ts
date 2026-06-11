// Validación para documentos vehiculares
import { z } from 'zod/v4';

export const documentSchema = z.object({
  vehicleId: z.number().int().positive('Debe seleccionar un vehículo'),
  type: z.enum(['INVOICE', 'INSURANCE', 'VERIFICATION', 'CIRCULATION_CARD'], {
    error: 'Tipo de documento inválido',
  }),
  issuedAt: z.string().min(1, 'La fecha de emisión es obligatoria'),
  expiresAt: z.string().min(1, 'La fecha de vencimiento es obligatoria'),
  notes: z.string().max(500).optional().nullable(),
});

export type DocumentInput = z.infer<typeof documentSchema>;
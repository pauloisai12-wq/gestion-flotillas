// Validación de los campos del POST /api/qa-externa/ingest. Tras multer, los
// campos multipart llegan como strings; el router arma el body (incluyendo
// tipo/notas extraídos del JSON `metadata`) antes de llamar a safeParse.

import { z } from 'zod';

// UUID genérico (cualquier versión); el cliente manda v4.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const qaExternaIngestSchema = z.object({
  clienteRegistroId: z
    .string()
    .regex(UUID_RE, 'cliente_registro_id debe tener forma de UUID'),
  identificadorApp: z.string().min(1).max(200),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).optional(),
  capturadoAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: 'capturado_at no es una fecha ISO-8601 válida',
    })
    .transform((s) => new Date(s)),
  tipo: z.enum(['lona', 'reunion', 'barda', 'otro']),
  notas: z.string().max(5000).nullable().optional(),
});

export type QaExternaIngest = z.infer<typeof qaExternaIngestSchema>;

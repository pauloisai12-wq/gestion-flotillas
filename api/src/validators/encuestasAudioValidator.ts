// Campos de texto del multipart de POST /api/v1/encuestas/:idLocal/audios. Es la
// cara de DISPOSITIVO (zod plano + safeParse manual, 422 inline), no la del
// revisor. Los valores llegan como strings (multer no convierte nada), de ahí
// que tamano_bytes se valide como texto y se convierta después.

import { z } from 'zod';

export const SEGMENTO_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
// 10 dígitos como máximo: cualquier entero que quepa en INTEGER de Postgres.
const ENTERO_POSITIVO_RE = /^[1-9]\d{0,9}$/;

export const audioCamposSchema = z.object({
  segmento: z.string().regex(SEGMENTO_RE, 'segmento debe ser un nombre simple (letras, dígitos, ".", "_", "-"; máximo 64)'),
  sha256: z.string().regex(SHA256_HEX_RE, 'sha256 debe ser hexadecimal de 64 caracteres en minúsculas'),
  tamano_bytes: z
    .string()
    .regex(ENTERO_POSITIVO_RE, 'tamano_bytes debe ser un entero positivo')
    .transform(Number)
    .refine((n) => n <= 2_147_483_647, 'tamano_bytes fuera de rango'),
});

export type AudioCampos = z.infer<typeof audioCamposSchema>;

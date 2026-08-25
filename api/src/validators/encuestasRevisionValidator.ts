// Validación de la lectura de "Encuestas Okrean" (lado REVISOR_QA): listado
// paginado y exportación CSV. Es la cara JWT, así que usa `zod/v4` +
// validateQuery, NO el subpath plano con safeParse manual de la cara de
// dispositivo (encuestasIngestValidator.ts). Los dos conviven a propósito.
//
// page/limit se aceptan aquí solo para que no los rechace el schema: quien los
// normaliza (mínimos, tope) es parsePagination. Declararlos NO es decorativo:
// validateQuery REEMPLAZA req.query por el objeto parseado y zod estripa lo no
// declarado, así que sin ellos parsePagination leería siempre la página 1.
//
// Réplica del molde qaExternaPersonasValidator.ts. El módulo de encuestas no
// importa nada de qa_externa —ni siquiera `isoDate`— para poder borrarse entero
// sin tocar GeoCampo (mismo criterio que encuestasIngestValidator.ts:33-35).

import { z } from 'zod/v4';

// Copia local de `isoDate` (qaExternaRegistrosValidator.ts:12): una línea de
// regex no justifica atar este módulo al de GeoCampo.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa formato AAAA-MM-DD');

// v1 restauró `noElegible`, así que el filtro vuelve a tener dos estados reales.
const estadoFiltro = z.enum(['completada', 'noElegible']);

// A diferencia del molde —donde `dispositivo` es el id numérico del padrón— aquí
// el filtro va por TEXTO: el revisor conoce el equipo por su etiqueta
// ("encuestador-01"), no por su clave. El servicio lo traduce a un `contains`
// sobre dispositivo.identificador; el tope evita armar un LIKE enorme.
const dispositivoFiltro = z
  .string()
  .trim()
  .min(1, 'El filtro de dispositivo no puede ir vacío')
  .max(120, 'El filtro de dispositivo no puede exceder 120 caracteres');

// Filtro "solo con audio" / "solo sin audio". Llega como texto en la query, así
// que NO se usa z.coerce.boolean(): `Boolean('false')` es `true` y el filtro
// "sin audio" devolvería justo lo contrario de lo pedido. El enum acota los dos
// literales aceptados (cualquier otro texto es 400) y el transform los convierte
// a booleano; `undefined` se conserva para distinguir "sin filtro" de "false".
const conAudioFiltro = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

export const encuestasQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  dispositivo: dispositivoFiltro.optional(),
  estado: estadoFiltro.optional(),
  conAudio: conAudioFiltro,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export type EncuestasQueryInput = z.infer<typeof encuestasQuerySchema>;

// La exportación exige rango: sin él es demasiado fácil pedir el histórico
// completo de un tirón. El tope de filas lo aplica además el servicio.
//
// El .superRefine repite la validación de rango de qaPersonasExportQuerySchema
// (qaExternaPersonasValidator.ts:40-59) a propósito: extraerla obligaría a que
// este módulo dependiera de qa_externa, justo lo que se evita para poder
// borrarlo entero. Si algún día hay una tercera copia, unificar las tres.
export const encuestasExportQuerySchema = z
  .object({
    dispositivo: dispositivoFiltro.optional(),
    estado: estadoFiltro.optional(),
    conAudio: conAudioFiltro,
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

export type EncuestasExportQueryInput = z.infer<typeof encuestasExportQuerySchema>;

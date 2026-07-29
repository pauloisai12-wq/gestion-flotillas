// Validación del POST /api/qa-externa/personas: la segunda captura de GeoCampo
// ("registro de personas", sin foto). Es la cara de DISPOSITIVO, así que usa el
// subpath plano de zod + safeParse manual en el router, igual que
// qaExternaValidator.ts (la cara JWT usa zod/v4 + validateBody; no se mezclan).
//
// Por qué lat/lng/accuracy aceptan number Y string: el equipo móvil reutiliza su
// uploader multipart, y ahí TODO campo llega como string; en JSON llegan como
// number. Se admiten ambas formas sin duplicar el schema.
//
// Por qué NO se usa `z.coerce.number()` a secas (a diferencia de
// qaExternaValidator.ts, que solo sirve a /ingest y ES multipart-only): coerce
// llama a Number(), y Number(null) === Number('') === Number([]) ===
// Number(false) === 0, mientras que `.optional()` solo corta en `undefined`. En
// multipart eso da igual (un campo ausente llega `undefined` y un `null` es
// imposible: todo viaja como texto), pero /personas TAMBIÉN acepta JSON, y ahí
// un `{"lat":null,"lng":null,"accuracy":null}` se guardaría con 200 OK como una
// captura en el golfo de Guinea con precisión perfecta. Por eso la puerta se
// cierra ANTES del coerce: solo pasan `number` o string NO vacía.
//
// Por qué el teléfono se valida laxo: se dicta y se teclea en campo, con el
// formato que cada quien usa ('+52 55 1234 5678', '(55) 1234-5678',
// '5512345678'). Rechazar por formato perdería contactos reales, así que solo
// se acota la forma (caracteres admitidos y longitud) y se exige una cantidad
// plausible de dígitos REALES; si el número existe lo dirá quien marque.

import { z } from 'zod';
import { UUID_RE } from './qaExternaValidator';

// Solo dígitos y los separadores que la gente escribe a mano.
const TELEFONO_RE = /^[+()\d\s-]{7,20}$/;

/**
 * Entrada numérica tolerante con multipart pero HOSTIL al resto: `number` o
 * string no vacía, nada más. Deja fuera null, '', '   ', booleanos, arrays y
 * objetos, que es justo lo que `Number()` convertiría en 0 sin quejarse.
 */
const numeroLiteral = (mensaje: string) =>
  z.union([z.number(), z.string().trim().min(1, mensaje)], { error: mensaje });

export const qaExternaPersonaIngestSchema = z.object({
  clienteRegistroId: z
    .string()
    .regex(UUID_RE, 'cliente_registro_id debe tener forma de UUID'),
  identificadorApp: z.string().min(1).max(200),
  nombre: z
    .string()
    .trim()
    .min(1, 'nombre es obligatorio')
    .max(200, 'nombre no puede exceder 200 caracteres'),
  telefono: z
    .string()
    .trim()
    .regex(
      TELEFONO_RE,
      'telefono admite 7 a 20 caracteres entre dígitos, espacios y los signos + ( ) -',
    )
    // Los separadores no cuentan: lo que importa es que queden dígitos
    // suficientes para un número nacional o internacional (E.164 tope 15).
    .refine((s) => {
      const digitos = s.replace(/\D/g, '').length;
      return digitos >= 7 && digitos <= 15;
    }, { message: 'telefono debe contener entre 7 y 15 dígitos' }),
  lat: numeroLiteral('lat debe ser un número').pipe(
    z.coerce
      .number<string | number>({ error: 'lat debe ser un número' })
      .min(-90, 'lat debe estar entre -90 y 90')
      .max(90, 'lat debe estar entre -90 y 90'),
  ),
  lng: numeroLiteral('lng debe ser un número').pipe(
    z.coerce
      .number<string | number>({ error: 'lng debe ser un número' })
      .min(-180, 'lng debe estar entre -180 y 180')
      .max(180, 'lng debe estar entre -180 y 180'),
  ),
  // accuracy SÍ admite null y cadena en blanco ('' o solo espacios) además de
  // ausente, porque las cuatro cosas dicen lo mismo — "el GPS no reportó
  // precisión" — y la columna es nullable. Se normalizan a `undefined` ANTES de
  // tocar el coerce para que jamás acaben en 0 (0 m es una precisión perfecta, no
  // un dato faltante).
  //
  // El `trim()` importa: un cliente multipart que rellene sus campos con un
  // espacio cuando no tiene dato (`-F "accuracy= "`) mandaba '   ', que caía en
  // numeroLiteral y devolvía 400 mientras que '' pasaba — misma intención, dos
  // respuestas, y la captura se reintentaba en bucle.
  //
  // lat/lng NO reciben este trato: son obligatorias, y ahí null, '' y '   ' caen
  // todos en el 400 en vez de convertirse en la coordenada 0,0.
  accuracy: z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    numeroLiteral('accuracy debe ser un número')
      .pipe(
        z.coerce
          .number<string | number>({ error: 'accuracy debe ser un número' })
          .min(0, 'accuracy no puede ser negativa'),
      )
      .optional(),
  ),
  capturadoAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: 'capturado_at no es una fecha ISO-8601 válida',
    })
    .transform((s) => new Date(s)),
});

export type QaExternaPersonaIngest = z.infer<typeof qaExternaPersonaIngestSchema>;

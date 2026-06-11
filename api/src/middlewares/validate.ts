// Validación Zod en los bordes — sustituye el bloque safeParse +
// res.status(400) repetido en cada router. El formato de error se mantiene
// compatible con el inline anterior: { error: 'Datos inválidos', details: [...] }
// (el errorHandler añade code y requestId).

import { RequestHandler } from 'express';
import type { ZodType } from 'zod/v4';
import { BadRequest } from './errorHandler';

function toDetails(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}

/** Valida req.body contra el schema; si pasa, lo reemplaza por la versión parseada. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(BadRequest('Datos inválidos', toDetails(parsed.error.issues)));
    }
    req.body = parsed.data;
    next();
  };
}

/** Valida req.query contra el schema (usar z.coerce.* para números). */
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return next(BadRequest('Parámetros inválidos', toDetails(parsed.error.issues)));
    }
    req.query = parsed.data as typeof req.query;
    next();
  };
}

// Helpers compartidos de parsing HTTP — consolidan los patrones repetidos
// parseInt(req.params.id) + isNaN, paginación page/limit/skip y el
// null-check + 404 tras consultar la BD.

import { Request } from 'express';
import { BadRequest, NotFound } from '../middlewares/errorHandler';

/** Parámetro de ruta numérico (:id). Lanza 400 si no es un entero positivo. */
export function parseId(req: Request, param = 'id'): number {
  const value = Number(req.params[param]);
  if (!Number.isInteger(value) || value <= 0) {
    throw BadRequest(param === 'id' ? 'ID inválido' : `Parámetro ${param} inválido`);
  }
  return value;
}

/** Paginación normalizada: page ≥ 1, limit acotado a maxLimit. */
export function parsePagination(
  req: Request,
  opts?: { defaultLimit?: number; maxLimit?: number },
): { page: number; limit: number; skip: number } {
  const { defaultLimit = 20, maxLimit = 100 } = opts ?? {};
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/** Garantiza que el valor exista; si es null/undefined lanza 404. */
export function ensureFound<T>(value: T | null | undefined, resource = 'Recurso'): T {
  if (value === null || value === undefined) throw NotFound(resource);
  return value;
}

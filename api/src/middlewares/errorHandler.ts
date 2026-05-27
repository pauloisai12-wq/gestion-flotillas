// Error handler global — traduce errores técnicos a mensajes humanos

import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod/v4';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/** Excepción de aplicación con código HTTP y mensaje seguro para mostrar al usuario */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Atajos */
export const BadRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'BAD_REQUEST', details);
export const Unauthorized = (msg = 'No autenticado') => new AppError(401, msg, 'UNAUTHORIZED');
export const Forbidden = (msg = 'Sin permisos') => new AppError(403, msg, 'FORBIDDEN');
export const NotFound = (resource = 'Recurso') => new AppError(404, `${resource} no encontrado`, 'NOT_FOUND');
export const Conflict = (msg: string) => new AppError(409, msg, 'CONFLICT');
export const TooManyRequests = (msg = 'Demasiados intentos') => new AppError(429, msg, 'RATE_LIMITED');

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.getHeader('x-request-id') as string | undefined;

  // 1. AppError — ya viene con statusCode y mensaje seguro
  if (err instanceof AppError) {
    logger.warn({ err, requestId, path: req.path }, 'AppError');
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
      requestId,
    });
    return;
  }

  // 2. ZodError — validación fallida
  if (err instanceof ZodError) {
    logger.info({ err, requestId, path: req.path }, 'Validation failed');
    res.status(400).json({
      error: 'Datos inválidos',
      code: 'VALIDATION_ERROR',
      issues: err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
      requestId,
    });
    return;
  }

  // 3. Prisma errors — traducción humana
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.warn({ code: err.code, meta: err.meta, requestId }, 'Prisma error');
    switch (err.code) {
      case 'P2002': {
        const field = (err.meta?.target as string[] | undefined)?.join(', ') || 'campo';
        res.status(409).json({
          error: `Ya existe un registro con el mismo ${field}`,
          code: 'DUPLICATE',
          field,
          requestId,
        });
        return;
      }
      case 'P2025':
        res.status(404).json({ error: 'Registro no encontrado', code: 'NOT_FOUND', requestId });
        return;
      case 'P2003':
        res.status(400).json({
          error: 'No se puede completar la operación: hay registros relacionados',
          code: 'FK_CONSTRAINT',
          requestId,
        });
        return;
      case 'P2000':
        res.status(400).json({
          error: 'Un valor excede el tamaño máximo permitido',
          code: 'VALUE_TOO_LONG',
          requestId,
        });
        return;
      default:
        res.status(500).json({
          error: 'Error de base de datos',
          code: err.code,
          requestId,
        });
        return;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.warn({ err, requestId }, 'Prisma validation error');
    res.status(400).json({ error: 'Datos inválidos para la operación', code: 'VALIDATION_ERROR', requestId });
    return;
  }

  // 4. Errores de JWT (jsonwebtoken)
  if (err.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Sesión expirada. Inicia sesión nuevamente.', code: 'TOKEN_EXPIRED', requestId });
    return;
  }
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({ error: 'Token inválido', code: 'INVALID_TOKEN', requestId });
    return;
  }

  // 5. Multer (file upload)
  if (err.name === 'MulterError') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = err as any;
    const map: Record<string, string> = {
      LIMIT_FILE_SIZE: 'Archivo demasiado grande',
      LIMIT_FILE_COUNT: 'Demasiados archivos',
      LIMIT_UNEXPECTED_FILE: 'Campo de archivo inesperado',
    };
    res.status(400).json({ error: map[m.code] || 'Error subiendo archivo', code: m.code, requestId });
    return;
  }

  // 6. Fallback — error desconocido (5xx)
  logger.error({ err, requestId, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
    code: 'INTERNAL_ERROR',
    requestId,
    ...(env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  });
}

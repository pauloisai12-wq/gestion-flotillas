// Guard de las rutas /api/v1/encuestas/*. Autentica por API key de dispositivo
// (Authorization: Bearer <key>), separado del authMiddleware JWT y del padrón
// de qa_externa (tabla y pepper propios). Nunca loguea la key (Pino redacta el
// header authorization; tampoco la metemos en logs).

import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { hashEncuestasDeviceKey } from '../lib/encuestasKeyHash';
import { Unauthorized } from './errorHandler';

/** Extrae la API key del header Authorization: Bearer <key>. */
function encuestasDeviceKeyFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw Unauthorized('Formato inválido. Use: Bearer <api_key>');
  }
  return parts[1];
}

export async function encuestasDeviceAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = encuestasDeviceKeyFromRequest(req);
    if (!key) return next(Unauthorized('API key requerida'));

    const keyHash = hashEncuestasDeviceKey(key);
    const device = await prisma.encuestaDispositivo.findUnique({ where: { keyHash } });
    if (!device || !device.activo) {
      return next(Unauthorized('API key inválida o revocada'));
    }

    req.encuestaDevice = { id: device.id, identificador: device.identificador };

    // Marca de uso, no bloqueante (no debe retrasar ni romper el request).
    void prisma.encuestaDispositivo
      .update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (err) {
    next(err);
  }
}

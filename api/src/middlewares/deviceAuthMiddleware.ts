// Guard de las rutas /api/qa-externa/*. Autentica por API key de dispositivo
// (Authorization: Bearer <key>), separado del authMiddleware JWT. Nunca loguea
// la key (Pino redacta el header authorization; tampoco la metemos en logs).

import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { hashDeviceKey } from '../lib/deviceKeyHash';
import { Unauthorized } from './errorHandler';

/** Extrae la API key del header Authorization: Bearer <key>. */
function deviceKeyFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw Unauthorized('Formato inválido. Use: Bearer <api_key>');
  }
  return parts[1];
}

export async function deviceAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = deviceKeyFromRequest(req);
    if (!key) return next(Unauthorized('API key requerida'));

    const keyHash = hashDeviceKey(key);
    const device = await prisma.qaExternaDispositivo.findUnique({ where: { keyHash } });
    if (!device || !device.activo) {
      return next(Unauthorized('API key inválida o revocada'));
    }

    req.device = { id: device.id, identificador: device.identificador };

    // Marca de uso, no bloqueante (no debe retrasar ni romper el request).
    void prisma.qaExternaDispositivo
      .update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    next();
  } catch (err) {
    next(err);
  }
}

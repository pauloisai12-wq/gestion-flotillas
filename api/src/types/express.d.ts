// Extensión global del tipo Request de Express para tipar `req.user`
// con el payload del JWT (en lugar de usar `(req as any).user`).
//
// El authMiddleware popula `req.user` después de verificar el token.
// El campo es opcional porque rutas públicas no lo tienen.

import type { JwtPayload } from '../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      // Populado por deviceAuthMiddleware en las rutas /api/qa-externa/* tras
      // validar la API key del dispositivo (separado de req.user / JWT).
      device?: { id: number; identificador: string; programa: 'BUFFALO' | 'LX' };
    }
  }
}

export {};

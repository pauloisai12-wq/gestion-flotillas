// /api/src/routes/authRouter.ts — login con rate limit + manejo de errores estándar

import { Router, Request, Response, NextFunction, CookieOptions } from 'express';
import { z } from 'zod/v4';
import { login, getUserById } from '../services/authService';
import { authMiddleware } from '../middlewares/authMiddleware';
import { rateLimit, getClientIp } from '../middlewares/rateLimit';
import { Unauthorized } from '../middlewares/errorHandler';
import { env } from '../config/env';

const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  password: z.string().min(1, 'Contraseña obligatoria'),
});

/**
 * Opciones de la cookie de sesión.
 * httpOnly: la cookie NO es accesible desde JavaScript (defensa contra XSS).
 * sameSite=lax: bloquea cross-site en requests "peligrosos" (POST cross-origin).
 * secure: solo se envía sobre HTTPS en producción. En dev (HTTP) se permite.
 */
const sessionCookieOpts: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: 8 * 60 * 60 * 1000, // 8h, alineado con JWT_EXPIRES_IN por defecto
};

/**
 * POST /api/auth/login — protegido contra brute-force con rate-limit en Redis
 * Límite: 5 intentos por IP+email cada 60s (configurable por env)
 */
authRouter.post(
  '/login',
  rateLimit({
    max: env.RATE_LIMIT_LOGIN_MAX,
    windowSec: env.RATE_LIMIT_LOGIN_WINDOW_SEC,
    keyBuilder: (req) => `login:${getClientIp(req)}:${(req.body?.email || '').toLowerCase()}`,
    message: 'Demasiados intentos de inicio de sesión. Espera un minuto.',
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const result = await login(email, password);
      // Emite la cookie httpOnly de sesión. El token también va en el JSON por
      // compatibilidad con clientes que lo usen como Bearer header (transición).
      res.cookie('token', result.token, sessionCookieOpts);
      res.json({ status: 'ok', message: 'Login exitoso', data: result });
    } catch (error) {
      // Mensaje genérico para no filtrar si el email existe
      if ((error as Error).message?.includes('inválid') || (error as Error).message?.includes('desactivado')) {
        return next(Unauthorized('Credenciales inválidas'));
      }
      next(error);
    }
  },
);

/**
 * GET /api/auth/me — datos del usuario autenticado
 */
authRouter.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await getUserById(req.user!.userId);
    res.json({ status: 'ok', data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout — limpia la cookie de sesión en el cliente.
 * (Para invalidación real del JWT necesitaríamos blacklist en Redis, fuera de scope.)
 */
authRouter.post('/logout', authMiddleware, (_req: Request, res: Response): void => {
  res.clearCookie('token', { ...sessionCookieOpts, maxAge: undefined });
  res.json({ status: 'ok', message: 'Sesión cerrada' });
});

export default authRouter;

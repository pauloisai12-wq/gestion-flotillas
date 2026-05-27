// /api/src/routes/authRouter.ts — login con rate limit + manejo de errores estándar

import { Router, Request, Response, NextFunction } from 'express';
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
 * POST /api/auth/logout — server-side noop; el cliente borra el token
 * (Para invalidación real necesitaríamos blacklist en Redis, fuera de scope)
 */
authRouter.post('/logout', authMiddleware, (_req: Request, res: Response): void => {
  res.json({ status: 'ok', message: 'Sesión cerrada' });
});

export default authRouter;

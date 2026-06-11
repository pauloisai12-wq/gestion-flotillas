// Auth router — login con rate limit + manejo de errores estándar

import { Router, Request, Response, NextFunction, CookieOptions } from 'express';
import { z } from 'zod/v4';
import { login, getUserById, blacklistToken } from '../services/authService';
import { authMiddleware, tokenFromRequest } from '../middlewares/authMiddleware';
import { rateLimit, getClientIp } from '../middlewares/rateLimit';
import { ah } from '../lib/asyncHandler';
import { logger } from '../lib/logger';
import { env } from '../config/env';

const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  password: z.string().min(1, 'Contraseña obligatoria'),
});

/**
 * Opciones de la cookie de sesión.
 * httpOnly: la cookie NO es accesible desde JavaScript (defensa contra XSS).
 * sameSite=strict: la cookie NO viaja en NINGUNA petición iniciada por otro
 *   sitio (cierra CSRF, incl. formularios multipart auto-enviados). El panel y
 *   la API comparten origen vía el proxy de Next, así que no rompe el flujo.
 * secure: solo se envía sobre HTTPS en producción. En dev (HTTP) se permite.
 */
const sessionCookieOpts: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
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
    // Si Redis cae, NO desactivar la protección anti brute-force del login.
    failClosed: true,
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // safeParse (no throw): si el body no es válido, propaga el ZodError al
      // errorHandler global, que ya lo traduce a 400.
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(parsed.error);
      }
      const { email, password } = parsed.data;
      const result = await login(email, password);
      // Emite la cookie httpOnly de sesión. El token también va en el JSON por
      // compatibilidad con clientes que lo usen como Bearer header (transición).
      res.cookie('token', result.token, sessionCookieOpts);
      res.json({ status: 'ok', message: 'Login exitoso', data: result });
    } catch (error) {
      // authService lanza AppError (Unauthorized) con el mensaje seguro;
      // el errorHandler global lo traduce al status/JSON correcto.
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
 * POST /api/auth/logout — invalida el JWT (blacklist en Redis hasta su
 * expiración) y limpia la cookie de sesión en el cliente.
 */
authRouter.post(
  '/logout',
  authMiddleware,
  ah(async (req: Request, res: Response): Promise<void> => {
    try {
      const token = tokenFromRequest(req);
      if (token) await blacklistToken(token);
    } catch (err) {
      // Fail-open: si Redis/extracción fallan, el logout sigue limpiando la cookie.
      logger.warn({ err: (err as Error).message }, 'No se pudo invalidar el token en logout');
    }
    res.clearCookie('token', { ...sessionCookieOpts, maxAge: undefined });
    res.json({ status: 'ok', message: 'Sesión cerrada' });
  }),
);

export default authRouter;

// Servicio de autenticación — login, verificación de JWT y blacklist de logout en Redis

import { UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import prisma from '../lib/prisma';
import { getRedis } from '../lib/redis';
import { Unauthorized } from '../middlewares/errorHandler';

// Interfaz del payload que se guarda dentro del token JWT
export interface JwtPayload {
  userId: number;
  email: string;
  role: UserRole;
}

// Interfaz de la respuesta de login (lo que recibe el frontend)
export interface LoginResponse {
  token: string;
  user: {
    id: number;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

/**
 * Autentica un usuario con email y contraseña.
 * Retorna un token JWT si las credenciales son válidas.
 */
// Hash bcrypt dummy (mismo coste que los reales), precomputado una vez. Se usa
// cuando el usuario no existe para que el tiempo de respuesta sea constante y
// no se pueda enumerar cuentas válidas por timing.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-dummy', env.BCRYPT_ROUNDS);

export async function login(email: string, password: string): Promise<LoginResponse> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Siempre se paga el coste de bcrypt, exista o no el usuario (timing constante).
  const passwordValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordValid) {
    throw Unauthorized('Credenciales inválidas');
  }

  if (!user.isActive) {
    throw Unauthorized('Usuario desactivado. Contacte al administrador.');
  }

  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  } as SignOptions);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
  };
}

/**
 * Verifica un token JWT y retorna el payload.
 */
export function verifyToken(token: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    return decoded;
  } catch (error) {
    throw new Error('Token inválido o expirado');
  }
}

/**
 * Obtiene los datos de un usuario por su ID (sin contraseña).
 */
export async function getUserById(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      // Solo aplica a role=WORKSHOP; el frontend lo usa para vincular sus quotes.
      workshopId: true,
    },
  });

  if (!user || !user.isActive) {
    throw Unauthorized('Usuario no encontrado');
  }

  return user;
}

// --- Blacklist de logout (Redis) ---------------------------------------------
// Un JWT robado seguiría siendo válido hasta su expiración (8h por defecto):
// al cerrar sesión se registra el hash del token en Redis con TTL = vida
// restante, y authMiddleware lo rechaza. Política FAIL-OPEN consciente: si
// Redis falla se hace logger.warn y NO se lanza — la autenticación no debe
// caerse por Redis (mismo criterio documentado en el rate-limit).

const BLACKLIST_PREFIX = 'jwt:blacklist:';

/** Clave Redis derivada del token (sha256 hex; no se guarda el JWT crudo). */
function blacklistKey(token: string): string {
  return BLACKLIST_PREFIX + createHash('sha256').update(token).digest('hex');
}

/**
 * Invalida un token (logout): lo registra en la blacklist de Redis hasta su
 * expiración natural. Si el token no tiene `exp` o ya expiró, no guarda nada.
 */
export async function blacklistToken(token: string): Promise<void> {
  // decode (sin verificar) basta: solo necesitamos el exp para calcular el TTL.
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const exp = decoded?.exp;
  if (!exp) return;

  const ttlSec = exp - Math.floor(Date.now() / 1000);
  if (ttlSec <= 0) return;

  try {
    await getRedis().set(blacklistKey(token), '1', 'EX', ttlSec);
  } catch (err) {
    // Fail-open: el logout no se rompe porque Redis esté caído.
    logger.warn({ err: (err as Error).message }, 'No se pudo registrar el token en la blacklist');
  }
}

/**
 * Indica si un token fue invalidado por logout. En error de Redis devuelve
 * false (fail-open): la autenticación no se cae por Redis.
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    return (await getRedis().get(blacklistKey(token))) !== null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'No se pudo consultar la blacklist de tokens');
    return false;
  }
}

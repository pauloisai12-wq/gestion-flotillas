// Archivo: /flotillas/api/src/services/authService.ts
// REEMPLAZA: Archivo completo — ahora usa PrismaClient centralizado
import { UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import prisma from '../lib/prisma';

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
    throw new Error('Credenciales inválidas');
  }

  if (!user.isActive) {
    throw new Error('Usuario desactivado. Contacte al administrador.');
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
    throw new Error('Usuario no encontrado');
  }

  return user;
}
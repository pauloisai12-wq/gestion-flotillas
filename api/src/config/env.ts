// Validación estricta de variables de entorno al arranque.
// Si algo crítico falta o es débil, el proceso ABORTA con mensaje claro.
// NO hay fallbacks hardcoded — todo debe venir del .env.

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  REDIS_URL: z.string().min(1, 'REDIS_URL es obligatorio'),

  // JWT: mínimo 32 caracteres. En producción >= 64.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres. Genera uno con: openssl rand -base64 64'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // Bcrypt rounds — 12 en producción (más fuerte vs ataques offline)
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // CORS: lista separada por comas con orígenes permitidos
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // Confianza en proxies para recuperar la IP real del cliente (X-Forwarded-For).
  // Detrás de Caddy/Next, sin esto req.ip colapsa a la IP interna del proxy y
  // rate-limit / CSRF-por-IP / remoteip de Turnstile dejan de discriminar.
  // Valores: 'false' (sin proxy), un nº de saltos confiables ('1','2',…), una
  // lista de IPs/subredes separadas por coma, o 'true' (NO recomendado: permite
  // spoofing de X-Forwarded-For).
  TRUST_PROXY: z.string().default('false'),

  // Captcha del portal público (opcional en dev, obligatorio en prod)
  TURNSTILE_SECRET: z.string().optional(),

  // Rate limits (configurables)
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_LOGIN_WINDOW_SEC: z.coerce.number().int().min(10).default(60),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_PUBLIC_WINDOW_SEC: z.coerce.number().int().min(10).default(60),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Sentry (opcional). Si está vacío, la integración no se inicializa.
  // Si se provee, debe tener formato de DSN (https://...@...sentry.io/...).
  SENTRY_DSN: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^https?:\/\/[^@]+@[^/]+\/\d+$/.test(v),
      'SENTRY_DSN no tiene un formato válido (esperado: https://<key>@<host>/<projectId>)',
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuración inválida — el proceso no puede arrancar:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\n💡 Verifica tu archivo .env');
  process.exit(1);
}

// Validaciones extras de producción
if (parsed.data.NODE_ENV === 'production') {
  const errors: string[] = [];
  if (parsed.data.JWT_SECRET.length < 64) {
    errors.push('JWT_SECRET debe tener al menos 64 caracteres en producción');
  }
  if (!parsed.data.TURNSTILE_SECRET) {
    errors.push('TURNSTILE_SECRET es obligatorio en producción (portal público)');
  }
  if (parsed.data.CORS_ALLOWED_ORIGINS.some((o) => o.includes('localhost'))) {
    errors.push('CORS_ALLOWED_ORIGINS no debe contener localhost en producción');
  }
  if (parsed.data.BCRYPT_ROUNDS < 12) {
    errors.push('BCRYPT_ROUNDS debe ser >= 12 en producción');
  }
  if (errors.length > 0) {
    console.error('❌ Producción rechazada por configuración insegura:\n');
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(1);
  }
}

export const env = parsed.data;

// Alias retro-compatible para código existente
export const ENV = {
  DATABASE_URL: env.DATABASE_URL,
  REDIS_URL: env.REDIS_URL,
  JWT_SECRET: env.JWT_SECRET,
  JWT_EXPIRES_IN: env.JWT_EXPIRES_IN,
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
};

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

  // Directorio compartido (con el worker) donde se generan/sirven los reportes.
  // Debe coincidir con el del worker y con el bind mount del compose. No derivar
  // de __dirname (frágil entre dist/ y src/ y según la profundidad de carpetas).
  REPORTS_DIR: z.string().default('/app/storage/reports'),

  // qa_externa (ingesta de Evidencia Externa de GeoCampo). Todas opcionales con
  // default: NO añaden un secreto obligatorio en producción (no rompen env.ts).
  QA_EXTERNA_DIR: z.string().default('/app/uploads/qa-externa'),
  QA_EXTERNA_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(12),
  QA_EXTERNA_MAX_FILES: z.coerce.number().int().min(1).max(20).default(5),
  // Cuota POR DISPOSITIVO de cada captura (cubos independientes: `qae:dev:` para
  // /ingest y `qae:per:` para /personas). Es la cuota de captura propiamente dicha.
  QA_EXTERNA_RATE_MAX: z.coerce.number().int().min(1).default(60),
  QA_EXTERNA_RATE_WINDOW_SEC: z.coerce.number().int().min(10).default(60),
  // Cuota del cubo POR IP del montaje /api/qa-externa (`qae:ip:`), que corre
  // PRE-auth: su papel es frenar el sondeo de API keys, no repartir cuota de
  // captura. Por eso NO comparte número con QA_EXTERNA_RATE_MAX: si lo hiciera,
  // un teléfono que vacía sus dos colas al recuperar señal (p. ej. 50 personas +
  // 20 evidencias en el mismo minuto contra un tope de 60) agotaría con una
  // captura el presupuesto de la otra y recibiría 429 en la más cara.
  // Default = 2 × QA_EXTERNA_RATE_MAX (60 → 120): zod no puede derivar el default
  // de otro campo del mismo objeto, así que va como literal. Si cambias
  // QA_EXTERNA_RATE_MAX, ajusta este a mano para mantener la proporción.
  QA_EXTERNA_IP_RATE_MAX: z.coerce.number().int().min(1).default(120),
  // Pepper opcional para HMAC-SHA256 de las API keys (defensa en profundidad).
  QA_EXTERNA_KEY_PEPPER: z.string().optional(),

  // Encuestas Okrean (ingesta móvil, módulo separado de qa_externa). Todas
  // opcionales con default: NO añaden un secreto obligatorio en producción (no
  // rompen env.ts ni las plantillas de .env).
  // Cuota POR DISPOSITIVO de la ingesta (cubo `enc:dev:`), la cuota de captura
  // propiamente dicha.
  ENCUESTAS_RATE_MAX: z.coerce.number().int().min(1).default(60),
  ENCUESTAS_RATE_WINDOW_SEC: z.coerce.number().int().min(10).default(60),
  // Cuota del cubo POR IP del montaje /api/v1/encuestas (`enc:ip:`), que corre
  // PRE-auth: su papel es frenar el sondeo de API keys, no repartir cuota de
  // captura. Por eso NO comparte número con ENCUESTAS_RATE_MAX: varios teléfonos
  // detrás de la misma salida a internet (o uno solo vaciando su cola tras
  // recuperar señal) agotarían con el sondeo el presupuesto de la captura.
  // Default = 2 × ENCUESTAS_RATE_MAX (60 → 120): zod no puede derivar el default
  // de otro campo del mismo objeto, así que va como literal. Si cambias
  // ENCUESTAS_RATE_MAX, ajusta este a mano para mantener la proporción.
  ENCUESTAS_IP_RATE_MAX: z.coerce.number().int().min(1).default(120),
  // Pepper opcional para HMAC-SHA256 de las API keys (defensa en profundidad).
  // Independiente de QA_EXTERNA_KEY_PEPPER: rotar uno no invalida al otro.
  ENCUESTAS_KEY_PEPPER: z.string().optional(),

  // Audios de encuesta (POST /api/v1/encuestas/:idLocal/audios). Bajo
  // /app/uploads para que lo cubran los mismos volúmenes/bind mounts que las
  // fotos de qa_externa. 50 MB es el "sugerido" del contrato móvil (~3.5 h de
  // AAC a 32 kbps); el operador puede bajarlo sin tocar código. NO van en las
  // plantillas .env: opcionales con default, como el resto de ENCUESTAS_*.
  ENCUESTAS_AUDIO_DIR: z.string().default('/app/uploads/encuestas-audio'),
  ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50),

  // Captcha del portal público (opcional en dev, obligatorio en prod si está habilitado)
  TURNSTILE_SECRET: z.string().optional(),

  // Interruptor del captcha. 'false' lo deshabilita por completo: no se exige
  // TURNSTILE_SECRET ni se valida el token. Pensado para despliegues internos
  // VPN-only sin formularios públicos en internet (CLAUDE.md §6.1). Default
  // 'true' (secure-by-default): hay que apagarlo EXPLÍCITAMENTE en el .env.
  TURNSTILE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

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
  // Solo se exige el secret si el captcha está HABILITADO. En despliegues
  // internos VPN-only (TURNSTILE_ENABLED=false) no aplica (CLAUDE.md §6.1).
  if (parsed.data.TURNSTILE_ENABLED && !parsed.data.TURNSTILE_SECRET) {
    errors.push('TURNSTILE_SECRET es obligatorio en producción cuando TURNSTILE_ENABLED=true (portal público)');
  }
  if (parsed.data.CORS_ALLOWED_ORIGINS.some((o) => o.includes('localhost'))) {
    errors.push('CORS_ALLOWED_ORIGINS no debe contener localhost en producción');
  }
  if (parsed.data.BCRYPT_ROUNDS < 12) {
    errors.push('BCRYPT_ROUNDS debe ser >= 12 en producción');
  }
  // Rechazar valores placeholder de las plantillas .env(.staging).example: un
  // JWT_SECRET placeholder mide >64 chars y pasaría la validación de longitud,
  // pero es público (está en el repo) → forjado de tokens.
  const PLACEHOLDER_RE = /CAMBIA_ESTO|genera_con_openssl|tu_password|tu_usuario|tu_base_de_datos/i;
  if (PLACEHOLDER_RE.test(parsed.data.JWT_SECRET)) {
    errors.push('JWT_SECRET es un valor placeholder de .example; genera uno real con: openssl rand -base64 64');
  }
  if (PLACEHOLDER_RE.test(parsed.data.DATABASE_URL)) {
    errors.push('DATABASE_URL contiene credenciales placeholder; reemplázalas por las reales');
  }
  if (PLACEHOLDER_RE.test(parsed.data.REDIS_URL)) {
    errors.push('REDIS_URL contiene una contraseña placeholder; reemplázala por la real');
  }
  // Rechazar las "test keys" always-pass de Cloudflare Turnstile (1x/2x/3x0000…):
  // pasan la validación de presencia pero dejan el captcha decorativo.
  if (parsed.data.TURNSTILE_ENABLED && parsed.data.TURNSTILE_SECRET && /^[123]x0000/.test(parsed.data.TURNSTILE_SECRET)) {
    errors.push('TURNSTILE_SECRET es una test key always-pass de Cloudflare; usa el secret real en producción');
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

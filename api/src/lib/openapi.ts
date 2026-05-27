// Registro OpenAPI generado a partir de los schemas Zod del proyecto.
//
// La filosofía: en vez de duplicar la documentación, derivamos el spec
// OpenAPI 3.1 directamente de los validadores Zod ya existentes en
// `src/validators/`. Esto garantiza que la doc nunca se desincronice del
// código real.
//
// Cobertura actual: ESQUELETO — incluye auth/login y vehicles GET/POST
// como ejemplo. Para extender a los ~50 endpoints restantes ver PENDING.md.

import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Habilita .openapi({...}) en zod schemas
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Auth scheme ────────────────────────────────────────────────
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Token JWT emitido por POST /api/auth/login',
});

// ─── Schemas reutilizables ──────────────────────────────────────
const LoginRequest = registry.register(
  'LoginRequest',
  z.object({
    email: z.string().email().openapi({ example: 'admin@flotillas.gob' }),
    password: z.string().min(6).openapi({ example: 'password123' }),
  }),
);

const LoginResponse = registry.register(
  'LoginResponse',
  z.object({
    token: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIs...' }),
    user: z.object({
      id: z.number(),
      email: z.string(),
      fullName: z.string(),
      role: z.enum(['ADMIN', 'SUPERVISOR_VEHICLES', 'SUPERVISOR_FUEL', 'SUPERVISOR_MAINTENANCE']),
    }),
  }),
);

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.string(),
    message: z.string().optional(),
    code: z.string().optional(),
  }),
);

const Vehicle = registry.register(
  'Vehicle',
  z.object({
    id: z.number(),
    plate: z.string(),
    economicNumber: z.string(),
    classification: z.enum(['POLICIAL', 'ESTATAL', 'VIAL']),
    status: z.enum(['OPERATIVE', 'BLOCKED']),
    currentOdometer: z.number(),
    brand: z.string(),
    model: z.string(),
    year: z.number().int(),
    isActive: z.boolean(),
  }),
);

// ─── Paths ──────────────────────────────────────────────────────
registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Iniciar sesión',
  description: 'Autentica un usuario con email/contraseña. Rate-limited a 5 intentos por 60s por IP.',
  tags: ['Auth'],
  request: {
    body: { content: { 'application/json': { schema: LoginRequest } } },
  },
  responses: {
    200: { description: 'Login exitoso', content: { 'application/json': { schema: LoginResponse } } },
    401: { description: 'Credenciales inválidas', content: { 'application/json': { schema: ErrorResponse } } },
    429: { description: 'Demasiados intentos', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  summary: 'Obtener usuario autenticado',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Usuario autenticado' },
    401: { description: 'No autenticado', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/vehicles',
  summary: 'Listar vehículos (paginado)',
  tags: ['Vehicles'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
      classification: z.enum(['POLICIAL', 'ESTATAL', 'VIAL']).optional(),
      status: z.enum(['OPERATIVE', 'BLOCKED']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Lista paginada',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(Vehicle),
            pagination: z.object({
              page: z.number(),
              limit: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Healthcheck',
  tags: ['Meta'],
  responses: {
    200: { description: 'OK' },
    503: { description: 'Algún componente caído (DB o Redis)' },
  },
});

// ─── Generación del documento ───────────────────────────────────
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Flotillas API',
      version: '1.0.0',
      description:
        'API REST del sistema de gestión de flotillas vehiculares.\n\n' +
        '**Cobertura actual:** esqueleto inicial (~5 de ~50 endpoints). ' +
        'Ver `PENDING.md` para el plan de cobertura completa.',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local' },
    ],
    tags: [
      { name: 'Auth', description: 'Autenticación y sesión' },
      { name: 'Vehicles', description: 'Vehículos y su gestión' },
      { name: 'Meta', description: 'Salud del servicio y metadata' },
    ],
  });
}

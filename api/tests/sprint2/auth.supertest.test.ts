import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod/v4';
import { Unauthorized } from '../../src/middlewares/errorHandler';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock('../../src/services/authService', () => ({
  login: mocks.login,
  getUserById: vi.fn(),
  blacklistToken: vi.fn(),
  verifyToken: vi.fn(),
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/middlewares/rateLimit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    RATE_LIMIT_LOGIN_MAX: 5,
    RATE_LIMIT_LOGIN_WINDOW_SEC: 60,
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

import authRouter from '../../src/routes/authRouter';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ code: 'VALIDATION_ERROR' });
      return;
    }
    const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 500;
    res.status(statusCode).json({ code: err?.code ?? 'INTERNAL_ERROR', error: err?.message });
  };
  app.use(errors);
  return app;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    mocks.login.mockReset();
  });

  it('normaliza el correo y emite cookie httpOnly/Strict', async () => {
    mocks.login.mockResolvedValue({
      token: 'signed-token',
      user: {
        id: 1,
        email: 'admin@example.com',
        fullName: 'Admin',
        role: 'ADMIN',
        workshopId: null,
      },
    });

    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ email: '  ADMIN@EXAMPLE.COM ', password: 'secret' });

    expect(response.status).toBe(200);
    expect(mocks.login).toHaveBeenCalledWith('admin@example.com', 'secret');
    expect(response.headers['set-cookie'][0]).toContain('token=signed-token');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
  });

  it('rechaza un contrato inválido antes del servicio', async () => {
    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ email: 'no-es-correo', password: '' });

    expect(response.status).toBe(400);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('propaga credenciales inválidas como 401 seguro', async () => {
    mocks.login.mockRejectedValue(Unauthorized('Credenciales inválidas'));

    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'bad' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

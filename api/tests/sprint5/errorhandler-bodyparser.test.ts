// Las dos ramas de body-parser del errorHandler, contra el parser real.
//
// `express.json()` rechaza el cuerpo antes de que ningún router lo vea, y su
// error no es un AppError ni trae un `name` propio: hasta ahora caía al
// fallback y el cliente recibía un 500 (más el ruido en Sentry) por un fallo
// que era suyo. El límite de 1 kb es solo para poder dispararlo con un cuerpo
// pequeño; en la app real lo fija cada montaje.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const registrado = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/lib/logger', () => ({ logger: registrado }));

import { errorHandler } from '../../src/middlewares/errorHandler';

const REQUEST_ID = 'req-bodyparser-test';

function crearApp() {
  const app = express();
  // En la app real la estampa pino-http; el errorHandler la lee de la
  // respuesta para devolver `requestId`.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-request-id', REQUEST_ID);
    next();
  });
  app.use(express.json({ limit: '1kb' }));
  app.post('/eco', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  app.post('/explota', (_req: Request, _res: Response) => {
    throw new Error('boom');
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler — errores de body-parser', () => {
  it('un cuerpo dentro del límite sigue llegando al handler con 200', async () => {
    const response = await request(crearApp()).post('/eco').send({ texto: 'hola' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('un JSON válido por encima del límite responde 413 PAYLOAD_TOO_LARGE', async () => {
    const response = await request(crearApp())
      .post('/eco')
      .send({ texto: 'a'.repeat(2048) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'El cuerpo de la petición excede el tamaño permitido',
      code: 'PAYLOAD_TOO_LARGE',
      requestId: REQUEST_ID,
    });
    expect(registrado.error).not.toHaveBeenCalled();
  });

  it('un JSON malformado responde 400 BAD_JSON sin devolver el cuerpo recibido', async () => {
    const response = await request(crearApp())
      .post('/eco')
      .set('Content-Type', 'application/json')
      .send('{ esto no es json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'JSON malformado',
      code: 'BAD_JSON',
      requestId: REQUEST_ID,
    });
    // El error de body-parser arrastra el cuerpo crudo en `err.body`: ni la
    // respuesta ni el log deben repetirlo.
    expect(response.text).not.toContain('esto no es json');
    expect(registrado.error).not.toHaveBeenCalled();
  });

  it('el fallback 500 sigue intacto para cualquier otro error', async () => {
    const response = await request(crearApp()).post('/explota').send({ ok: true });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.requestId).toBe(REQUEST_ID);
    expect(registrado.error).toHaveBeenCalledTimes(1);
  });
});

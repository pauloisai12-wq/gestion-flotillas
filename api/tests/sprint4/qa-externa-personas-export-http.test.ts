// Momento en que GET /api/qa-externa-personas/export.csv compromete el 200.
//
// El BOM + los encabezados se escribían ANTES de abrir el iterador, así que
// ningún fallo del lado de la BD podía ya convertirse en 5xx: se registraba en el
// log y se cerraba un archivo truncado con un 200 aparentemente normal. Con un
// fallo en el PRIMER lote el revisor descargaba un CSV con solo la fila de
// encabezados, indistinguible de "no hay datos".
//
// Ahora la cabecera se retrasa hasta tener el primer lote en mano. Lo que este
// test fija es justo eso: antes del primer lote todavía se puede fallar con 500.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/prisma', () => ({ default: {} }));

const registrado = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/lib/logger', () => ({ logger: registrado }));

// Solo se sustituye el iterador: csvEscape/toCsvRow/QA_PERSONAS_CSV_HEADERS
// siguen siendo los reales, que es lo que se está comprobando que se emite.
const iterateForExport = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/qaExternaPersonasService', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../src/services/qaExternaPersonasService')>();
  return { ...real, iterateForExport };
});

import personasRouter from '../../src/routes/qaExternaPersonasRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { Roles } from '../../src/middlewares/roleMiddleware';
import {
  QA_PERSONAS_CSV_HEADERS,
  type QaPersonaDto,
} from '../../src/services/qaExternaPersonasService';

function crearApp() {
  const app = express();
  // El authMiddleware (JWT) vive en el montaje de index.ts; aquí basta la
  // identidad que el requireRole del router espera encontrar.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { userId: 1, email: 'revisor@flotillas.invalid', role: Roles.REVISOR_QA };
    next();
  });
  app.use('/api/qa-externa-personas', personasRouter);
  app.use(errorHandler);
  return app;
}

const RUTA = '/api/qa-externa-personas/export.csv';
const FILTRO = { dateFrom: '2026-07-01', dateTo: '2026-07-31' };
const ENCABEZADOS = QA_PERSONAS_CSV_HEADERS.join(',');

function persona(overrides: Partial<QaPersonaDto> = {}): QaPersonaDto {
  return {
    id: 1,
    clienteRegistroId: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
    identificadorApp: 'geocampo-tablet-07',
    programa: 'LX',
    nombre: 'María Pérez',
    telefono: '5512345678',
    lat: 19.432608,
    lng: -99.133209,
    accuracy: 8.5,
    capturadoAt: new Date('2026-07-20T15:30:00.000Z'),
    createdAt: new Date('2026-07-20T15:31:00.000Z'),
    dispositivo: { id: 3, identificador: 'BUF-01' },
    ...overrides,
  };
}

describe('export.csv — cuándo se compromete el 200', () => {
  it('un fallo ANTES del primer lote sale como 500 y NO deja cabeceras de CSV', async () => {
    iterateForExport.mockImplementation(async function* () {
      throw new Error('conexión con la BD perdida');
      // eslint-disable-next-line no-unreachable
      yield [];
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    // Ninguna de las tres marcas del archivo llegó a escribirse.
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.text ?? '').not.toContain(ENCABEZADOS);
  });

  it('sin filas entrega igualmente BOM + encabezados con 200 (CSV vacío legítimo)', async () => {
    // eslint-disable-next-line require-yield
    iterateForExport.mockImplementation(async function* () {});

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      'personas-todos-2026-07-01_2026-07-31.csv',
    );
    expect(response.text).toBe(`﻿${ENCABEZADOS}\r\n`);
  });

  it('con filas escribe el archivo completo con 200', async () => {
    iterateForExport.mockImplementation(async function* () {
      yield [persona({ id: 1 }), persona({ id: 2, nombre: 'Juan Ruiz' })];
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.text.startsWith(`﻿${ENCABEZADOS}\r\n`)).toBe(true);
    expect(response.text).toContain('María Pérez');
    expect(response.text).toContain('Juan Ruiz');
    expect(registrado.error).not.toHaveBeenCalled();
  });

  // Límite conocido y documentado (docs/qa-externa.md, §CSV): a media descarga el
  // 200 y las cabeceras ya viajaron, y HTTP/1.1 sin trailers no permite corregirlo.
  it('un fallo DESPUÉS del primer lote cierra el archivo truncado con 200 y lo registra', async () => {
    iterateForExport.mockImplementation(async function* () {
      yield [persona({ id: 1 })];
      throw new Error('la conexión murió a medio camino');
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.text).toContain('María Pérez');
    expect(registrado.error).toHaveBeenCalledTimes(1);
    expect(registrado.error.mock.calls[0][1]).toBe(
      'Exportación CSV de personas interrumpida',
    );
  });

  it('HEAD sigue emitiendo cabeceras sin tocar la BD', async () => {
    const response = await request(crearApp()).head(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      'personas-todos-2026-07-01_2026-07-31.csv',
    );
    expect(iterateForExport).not.toHaveBeenCalled();
  });
});

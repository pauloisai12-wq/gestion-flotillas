// Contrato de la segunda captura de GeoCampo (POST /api/qa-externa/personas):
// idempotencia por cliente_registro_id, retry acotado ante P2002 y validación
// laxa de teléfono / coerción de multipart en el validador.

import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

// El servicio importa el cliente Prisma real solo para el default de deps; en
// los tests se inyecta un db falso, así que basta con neutralizar el módulo.
vi.mock('../../src/lib/prisma', () => ({ default: {} }));

vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  ingestPersonaWithDeps,
  type IngestPersonaInput,
} from '../../src/services/qaExternaPersonaService';
import { qaExternaPersonaIngestSchema } from '../../src/validators/qaExternaPersonaValidator';

type Db = Parameters<typeof ingestPersonaWithDeps>[1]['db'];

function fakeDb(parts: {
  updateMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
}): Db {
  return { qaExternaPersona: parts } as unknown as Db;
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/**
 * Prisma falso CON MEMORIA: guarda una fila por clienteRegistroId (índice único
 * real) y reparte ids autoincrementales, replicando la semántica de
 * updateMany/create/findUnique que usa el servicio.
 *
 * Con un `mockResolvedValue({ id: 42 })` la prueba de idempotencia era
 * tautológica: devolvía 42 aunque el servicio insertara una fila nueva cada vez.
 * Aquí dos claves distintas dan ids distintos y la misma clave da el mismo id,
 * así que una regresión que dejara de deduplicar sí rompe el test. Y como
 * updateMany respeta el `where.programa`, también rompe si el servicio vuelve a
 * permitir la sobrescritura cruzada entre programas.
 */
function fakeDbConMemoria() {
  type Fila = { id: number; clienteRegistroId: string; programa: string } & Record<
    string,
    unknown
  >;
  const filas = new Map<string, Fila>();
  let ultimoId = 41;
  const updateMany = vi.fn(
    async (args: {
      where: { clienteRegistroId: string; programa: string };
      data: Record<string, unknown>;
    }) => {
      const fila = filas.get(args.where.clienteRegistroId);
      if (!fila || fila.programa !== args.where.programa) return { count: 0 };
      Object.assign(fila, args.data);
      return { count: 1 };
    },
  );
  const create = vi.fn(
    async (args: { data: { clienteRegistroId: string } & Record<string, unknown> }) => {
      if (filas.has(args.data.clienteRegistroId)) throw p2002();
      const fila = { id: ++ultimoId, ...args.data } as Fila;
      filas.set(args.data.clienteRegistroId, fila);
      return fila;
    },
  );
  const findUnique = vi.fn(
    async (args: { where: { clienteRegistroId: string } }) =>
      filas.get(args.where.clienteRegistroId) ?? null,
  );
  return { db: fakeDb({ updateMany, create, findUnique }), updateMany, create, findUnique, filas };
}

const CLIENTE_ID = '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const OTRO_CLIENTE_ID = '11111111-2222-4333-8444-555555555555';

function input(overrides: Partial<IngestPersonaInput> = {}): IngestPersonaInput {
  return {
    clienteRegistroId: CLIENTE_ID,
    dispositivoId: 3,
    identificadorApp: 'geocampo-tablet-07',
    programa: 'LX',
    nombre: 'María Pérez',
    telefono: '+52 55 1234 5678',
    lat: 19.432608,
    lng: -99.133209,
    accuracy: 8.5,
    capturadoAt: new Date('2026-07-20T15:30:00.000Z'),
    metadataRaw: null,
    ...overrides,
  };
}

describe('ingestPersonaWithDeps', () => {
  it('reenviar el mismo cliente_registro_id no crea otra fila y devuelve el mismo id', async () => {
    const { db, updateMany, create, filas } = fakeDbConMemoria();

    const primera = await ingestPersonaWithDeps(input(), { db });
    const segunda = await ingestPersonaWithDeps(input({ nombre: 'María P.' }), { db });
    const otra = await ingestPersonaWithDeps(
      input({ clienteRegistroId: OTRO_CLIENTE_ID }),
      { db },
    );

    // Misma clave → el MISMO id y una sola fila; clave distinta → id distinto.
    // Lo segundo es lo que impide que un doble falso que siempre devuelve el
    // mismo id haga pasar la prueba sin que el servicio deduplique nada.
    expect(segunda.registroId).toBe(primera.registroId);
    expect(otra.registroId).not.toBe(primera.registroId);
    expect(filas.size).toBe(2);
    expect(create).toHaveBeenCalledTimes(2); // una por clave; el reenvío NO crea

    // Todo update va acotado a la partición del dispositivo autenticado y
    // NUNCA reescribe la clave de idempotencia.
    for (const call of updateMany.mock.calls) {
      expect(call[0].where).toEqual({
        clienteRegistroId: call[0].where.clienteRegistroId,
        programa: 'LX',
      });
      expect(call[0].data).not.toHaveProperty('clienteRegistroId');
    }
    expect(filas.get(CLIENTE_ID)).toMatchObject({ nombre: 'María P.' });
    expect(create.mock.calls[0][0].data).toMatchObject({
      clienteRegistroId: CLIENTE_ID,
      dispositivoId: 3,
      programa: 'LX',
      accuracy: 8.5,
      metadataRaw: null,
    });
  });

  it('la misma clave desde el OTRO programa responde 409 y la fila queda intacta', async () => {
    const { db, filas } = fakeDbConMemoria();

    const original = await ingestPersonaWithDeps(input(), { db }); // programa LX

    await expect(
      ingestPersonaWithDeps(
        input({ programa: 'BUFFALO', dispositivoId: 9, nombre: 'Intruso' }),
        { db },
      ),
    ).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 409,
      code: 'CONFLICT',
    });

    // La fila original no cambió de partición ni de contenido.
    expect(filas.size).toBe(1);
    expect(filas.get(CLIENTE_ID)).toMatchObject({
      id: original.registroId,
      programa: 'LX',
      dispositivoId: 3,
      nombre: 'María Pérez',
    });
  });

  it('carrera con la misma clave y el mismo programa: el que pierde el create cae en update', async () => {
    // updateMany no ve la fila, el create pierde la carrera (P2002) porque la
    // fila apareció en medio, y el reintento del update ya la encuentra.
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const findUnique = vi.fn().mockResolvedValue({ id: 77 });

    await expect(
      ingestPersonaWithDeps(input(), { db: fakeDb({ updateMany, create, findUnique }) }),
    ).resolves.toEqual({ registroId: 77 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('carrera con la misma clave desde el otro programa: acaba en 409, sin bucle', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockRejectedValue(p2002());
    const findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      ingestPersonaWithDeps(input(), { db: fakeDb({ updateMany, create, findUnique }) }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(2); // intento + un único reintento
  });

  it('propaga sin reintentar cualquier error del create que no sea P2002', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk violation', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    const findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      ingestPersonaWithDeps(input(), { db: fakeDb({ updateMany, create, findUnique }) }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('qaExternaPersonaIngestSchema', () => {
  function payload(overrides: Record<string, unknown> = {}) {
    return {
      clienteRegistroId: CLIENTE_ID,
      identificadorApp: 'geocampo-tablet-07',
      nombre: 'María Pérez',
      telefono: '5512345678',
      lat: 19.432608,
      lng: -99.133209,
      capturadoAt: '2026-07-20T15:30:00.000Z',
      ...overrides,
    };
  }

  it.each(['+52 55 1234 5678', '5512345678', '(55) 1234-5678'])(
    'acepta el teléfono tecleado en campo: %s',
    (telefono) => {
      expect(qaExternaPersonaIngestSchema.safeParse(payload({ telefono })).success).toBe(true);
    },
  );

  it.each(['12', 'abcdefgh', '1'.repeat(30)])('rechaza el teléfono inválido: %s', (telefono) => {
    expect(qaExternaPersonaIngestSchema.safeParse(payload({ telefono })).success).toBe(false);
  });

  it('rechaza coordenadas fuera de rango', () => {
    expect(qaExternaPersonaIngestSchema.safeParse(payload({ lat: 91 })).success).toBe(false);
    expect(qaExternaPersonaIngestSchema.safeParse(payload({ lng: -181 })).success).toBe(false);
  });

  it('rechaza una fecha de captura que no es ISO-8601', () => {
    const parsed = qaExternaPersonaIngestSchema.safeParse(payload({ capturadoAt: 'ayer' }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toBe(
        'capturado_at no es una fecha ISO-8601 válida',
      );
    }
  });

  it('rechaza el nombre vacío', () => {
    expect(qaExternaPersonaIngestSchema.safeParse(payload({ nombre: '' })).success).toBe(false);
    expect(qaExternaPersonaIngestSchema.safeParse(payload({ nombre: '   ' })).success).toBe(false);
  });

  it('acepta accuracy ausente y rechaza accuracy negativa', () => {
    expect(qaExternaPersonaIngestSchema.safeParse(payload()).success).toBe(true);
    expect(qaExternaPersonaIngestSchema.safeParse(payload({ accuracy: '-1' })).success).toBe(
      false,
    );
  });

  // Lo que Number() convertiría en 0 sin protestar. Multipart nunca manda estos
  // valores (todo llega como texto), pero /personas también acepta JSON, y un
  // {"lat":null,"lng":null} guardado como 0,0 es una captura en el golfo de
  // Guinea con 200 OK. La puerta se cierra ANTES del coerce.
  describe('lat/lng no se dejan coercer desde valores vacíos', () => {
    it.each([
      ['null', null],
      ['cadena vacía', ''],
      ['solo espacios', '   '],
      ['array vacío', []],
      ['true', true],
      ['false', false],
      ['objeto', {}],
    ])('rechaza lat = %s', (_etiqueta, valor) => {
      expect(qaExternaPersonaIngestSchema.safeParse(payload({ lat: valor })).success).toBe(
        false,
      );
    });

    it.each([
      ['null', null],
      ['cadena vacía', ''],
      ['array vacío', []],
      ['true', true],
    ])('rechaza lng = %s', (_etiqueta, valor) => {
      expect(qaExternaPersonaIngestSchema.safeParse(payload({ lng: valor })).success).toBe(
        false,
      );
    });

    it('el mensaje del 400 nombra el campo, no habla de uniones', () => {
      const parsed = qaExternaPersonaIngestSchema.safeParse(payload({ lat: null }));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].path.join('.')).toBe('lat');
        expect(parsed.error.issues[0].message).toBe('lat debe ser un número');
      }
    });

    it('el 0 LITERAL sigue siendo una coordenada válida', () => {
      const parsed = qaExternaPersonaIngestSchema.safeParse(payload({ lat: 0, lng: '0' }));
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.lat).toBe(0);
        expect(parsed.data.lng).toBe(0);
      }
    });
  });

  describe('accuracy distingue "no reportada" de 0 m', () => {
    it.each([
      ['null', null],
      ['cadena vacía', ''],
      // Un cliente multipart que rellena sus campos con un espacio cuando no
      // tiene dato (`-F "accuracy= "`) manda esto. Antes caía en numeroLiteral y
      // devolvía 400 mientras que '' pasaba: misma intención, dos respuestas, y
      // la captura se reintentaba en bucle.
      ['solo espacios', '   '],
      ['tabulador', '\t'],
    ])('accuracy = %s pasa y queda AUSENTE, nunca en 0', (_etiqueta, valor) => {
      const parsed = qaExternaPersonaIngestSchema.safeParse(payload({ accuracy: valor }));
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.accuracy).toBeUndefined();
        expect(parsed.data.accuracy).not.toBe(0);
      }
    });

    it.each([
      ['string', '0'],
      ['number', 0],
    ])('accuracy = %s (0 m real) sí produce 0: el contrato admite accuracy >= 0', (
      _etiqueta,
      valor,
    ) => {
      const parsed = qaExternaPersonaIngestSchema.safeParse(payload({ accuracy: valor }));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.accuracy).toBe(0);
    });

    it.each([
      ['array vacío', []],
      ['true', true],
      ['texto no numérico', 'abc'],
    ])('rechaza accuracy = %s', (_etiqueta, valor) => {
      expect(qaExternaPersonaIngestSchema.safeParse(payload({ accuracy: valor })).success).toBe(
        false,
      );
    });

    // La tolerancia al blanco es EXCLUSIVA de accuracy: lat/lng son obligatorias
    // y ahí una cadena en blanco debe seguir siendo 400, no la coordenada 0,0.
    it.each([
      ['lat', 'lat'],
      ['lng', 'lng'],
    ])('%s con solo espacios sigue dando 400', (_etiqueta, campo) => {
      const parsed = qaExternaPersonaIngestSchema.safeParse(payload({ [campo]: '   ' }));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].path.join('.')).toBe(campo);
        expect(parsed.error.issues[0].message).toBe(`${campo} debe ser un número`);
      }
    });
  });

  it('coerciona lat/lng cuando llegan como string desde multipart', () => {
    const parsed = qaExternaPersonaIngestSchema.safeParse(
      payload({ lat: '19.432608', lng: '-99.133209', accuracy: '8.5' }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lat).toBe(19.432608);
      expect(parsed.data.lng).toBe(-99.133209);
      expect(parsed.data.accuracy).toBe(8.5);
      expect(parsed.data.capturadoAt).toBeInstanceOf(Date);
      // trim aplicado antes de validar la longitud.
      expect(parsed.data.nombre).toBe('María Pérez');
    }
  });
});

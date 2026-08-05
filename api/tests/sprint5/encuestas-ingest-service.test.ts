// Contrato de idempotencia de la ingesta de Encuestas Okrean: reenviar el mismo
// idLocal devuelve SIEMPRE el mismo idRemoto sin duplicar filas, el mismo
// idLocal con otro contenido es 409 sin sobrescribir, y un error que no sea el
// UNIQUE propaga sin dejar nada escrito.
//
// El doble de Prisma tiene MEMORIA (Map indexado por idLocal, que es el índice
// único real). Con un `mockResolvedValue({ idRemoto: 'x' })` la prueba sería
// tautológica: devolvería el mismo id aunque el servicio insertara una fila
// nueva en cada envío. Aquí dos idLocal distintos dan idRemoto distintos y el
// reenvío del mismo da el mismo, así que una regresión que dejara de deduplicar
// rompe el test.

import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

// El servicio importa el cliente Prisma real solo para el default de deps; en
// los tests se inyecta un db falso, así que basta con neutralizar el módulo.
vi.mock('../../src/lib/prisma', () => ({ default: {} }));

vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  ingestEncuestaWithDeps,
  type IngestEncuestaInput,
} from '../../src/services/encuestasIngestService';
import { encuestaV3Schema } from '../../src/validators/encuestasIngestValidator';
import { hashEncuestaV3 } from '../../src/lib/encuestasCanonical';
import {
  encuestaCompletaValida,
  sinClaves,
  type PayloadEncuesta,
} from './fixtures';

type Db = Parameters<typeof ingestEncuestaWithDeps>[1]['db'];

function fakeDb(parts: {
  create: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
}): Db {
  return { encuesta: parts } as unknown as Db;
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/** Prisma falso con memoria: replica el UNIQUE de idLocal y reparte idRemoto. */
function fakeDbConMemoria() {
  type Fila = { id: number; idRemoto: string; idLocal: string; payloadHash: string } & Record<
    string,
    unknown
  >;
  const filas = new Map<string, Fila>();
  let ultimoId = 0;
  const create = vi.fn(
    async (args: { data: { idLocal: string } & Record<string, unknown> }) => {
      if (filas.has(args.data.idLocal)) throw p2002();
      const id = ++ultimoId;
      const fila = {
        ...args.data,
        id,
        // El idRemoto real lo genera el @default(uuid()) del modelo; aquí basta
        // con que sea distinto por fila y estable dentro de ella.
        idRemoto: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      } as Fila;
      filas.set(args.data.idLocal, fila);
      return fila;
    },
  );
  const findUnique = vi.fn(
    async (args: { where: { idLocal: string } }) => filas.get(args.where.idLocal) ?? null,
  );
  return { db: fakeDb({ create, findUnique }), create, findUnique, filas };
}

const OTRO_ID_LOCAL = '11111111-2222-4333-8444-555555555555';

/** Recorre el camino real: validar (que estripa) y hashear lo que quedó. */
function entrada(
  payload: PayloadEncuesta,
  overrides: Partial<IngestEncuestaInput> = {},
): IngestEncuestaInput {
  const parsed = encuestaV3Schema.parse(payload);
  return {
    parsed,
    dispositivoId: 1,
    payloadHash: hashEncuestaV3(parsed),
    payloadRaw: JSON.stringify(payload),
    ...overrides,
  };
}

function conRespuestas(
  sobre: PayloadEncuesta,
  base: PayloadEncuesta = encuestaCompletaValida(),
): PayloadEncuesta {
  return { ...base, respuestas: { ...(base.respuestas as PayloadEncuesta), ...sobre } };
}

/** Los datos con que se llamó al create número `n` (0-based). */
function datosDelCreate(create: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  return create.mock.calls[n][0].data as Record<string, unknown>;
}

describe('ingestEncuestaWithDeps — idempotencia', () => {
  it('el reenvío idéntico devuelve el MISMO idRemoto y deja una sola fila', async () => {
    const { db, create, findUnique, filas } = fakeDbConMemoria();

    const primera = await ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), { db });
    const reenvio = await ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), { db });
    const otra = await ingestEncuestaWithDeps(
      entrada(encuestaCompletaValida({ idLocal: OTRO_ID_LOCAL })),
      { db },
    );

    expect(primera.created).toBe(true);
    expect(reenvio).toEqual({ idRemoto: primera.idRemoto, created: false });
    // idLocal distinto → registro distinto: es lo que impide que un doble que
    // siempre devuelve el mismo id haga pasar la prueba sin deduplicar nada.
    expect(otra.created).toBe(true);
    expect(otra.idRemoto).not.toBe(primera.idRemoto);

    expect(filas.size).toBe(2);
    // El reenvío SÍ intenta el INSERT (es el camino normal) y solo relee cuando
    // el UNIQUE salta.
    expect(create).toHaveBeenCalledTimes(3);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { idLocal: encuestaCompletaValida().idLocal },
    });
  });

  it('el mismo idLocal con otro contenido es 409 y la fila original queda intacta', async () => {
    const { db, filas } = fakeDbConMemoria();

    const original = await ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), { db });

    await expect(
      ingestEncuestaWithDeps(entrada(conRespuestas({ opinionLalo: 'mala' })), { db }),
    ).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 409,
      code: 'CONFLICT',
    });

    expect(filas.size).toBe(1);
    const fila = filas.get(encuestaCompletaValida().idLocal)!;
    expect(fila.idRemoto).toBe(original.idRemoto);
    expect(fila.opinionLalo).toBe('buena');
    expect(fila.payloadHash).toBe(entrada(encuestaCompletaValida()).payloadHash);
  });

  it('dos teléfonos con el MISMO folioLocal y distinto idLocal producen dos filas', async () => {
    // El folio sale de un talonario impreso: dos encuestadores pueden repetirlo
    // de forma legítima. La clave de idempotencia es idLocal, no el folio.
    const { db, filas } = fakeDbConMemoria();

    const primera = await ingestEncuestaWithDeps(
      entrada(encuestaCompletaValida({ folioLocal: 'LX-1042' }), { dispositivoId: 1 }),
      { db },
    );
    const segunda = await ingestEncuestaWithDeps(
      entrada(encuestaCompletaValida({ idLocal: OTRO_ID_LOCAL, folioLocal: 'LX-1042' }), {
        dispositivoId: 2,
      }),
      { db },
    );

    expect(primera.created).toBe(true);
    expect(segunda.created).toBe(true);
    expect(segunda.idRemoto).not.toBe(primera.idRemoto);
    expect(filas.size).toBe(2);
    expect([...filas.values()].map((f) => f.folioLocal)).toEqual(['LX-1042', 'LX-1042']);
    expect([...filas.values()].map((f) => f.dispositivoId)).toEqual([1, 2]);
  });
});

describe('ingestEncuestaWithDeps — carreras y errores', () => {
  it('si la fila aparece entre el SELECT y el INSERT, relee y devuelve su idRemoto', async () => {
    // Dos POST concurrentes del mismo registro (la app reintenta al recuperar
    // señal): el INSERT que pierde recibe P2002 y tiene que resolverse leyendo.
    const input = entrada(encuestaCompletaValida());
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const findUnique = vi
      .fn()
      .mockResolvedValue({ idRemoto: 'el-que-gano-la-carrera', payloadHash: input.payloadHash });

    await expect(
      ingestEncuestaWithDeps(input, { db: fakeDb({ create, findUnique }) }),
    ).resolves.toEqual({ idRemoto: 'el-que-gano-la-carrera', created: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('la carrera con contenido distinto acaba en 409, no en un idRemoto ajeno', async () => {
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const findUnique = vi
      .fn()
      .mockResolvedValue({ idRemoto: 'otro-registro', payloadHash: 'hash-de-otro-contenido' });

    await expect(
      ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), {
        db: fakeDb({ create, findUnique }),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('P2002 sin fila que lo explique se relanza tal cual (el teléfono reintenta)', async () => {
    // Choque de otro UNIQUE (idRemoto) o fila borrada en medio: no se inventa
    // un resultado ni se convierte en 409.
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), {
        db: fakeDb({ create, findUnique }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('un error que no es P2002 propaga y NO deja escrituras parciales', async () => {
    const { db, create, findUnique, filas } = fakeDbConMemoria();
    create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk violation', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );

    await expect(
      ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), { db }),
    ).rejects.toMatchObject({ code: 'P2003' });

    // El alta es un solo INSERT: o entra entera o no entra nada.
    expect(filas.size).toBe(0);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('ingestEncuestaWithDeps — aplanado a columnas', () => {
  it('la encuesta completada guarda todos los campos v3 y la ubicación disponible', async () => {
    const { db, create } = fakeDbConMemoria();

    await ingestEncuestaWithDeps(entrada(encuestaCompletaValida()), { db });

    expect(datosDelCreate(create)).toMatchObject({
      idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      dispositivoId: 1,
      versionCuestionario: 3,
      folioLocal: 'LX-1042',
      encuestador: 'María López',
      estado: 'completada',
      duracionSegundos: 400,
      sexo: 'mujer',
      rangoEdad: '31_45',
      empresariosConocidos: ['Juan Pérez'],
      politicosConocidos: ['Lalo Ximénez', 'Irineo Molina'],
      conoceLalo: 'si',
      rolLalo: 'politico_lider_social',
      opinionLalo: 'buena',
      preferenciaElectoral: 'lalo_ximenez',
      preferenciaPartido: 'morena',
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'buena' },
        { gobernante: 'jara', calificacion: 'regular' },
        { gobernante: 'huerta', calificacion: 'mala' },
      ],
      ubicacionDisponible: true,
      ubicacionLat: 19.432608,
      ubicacionLng: -99.133209,
      ubicacionPrecisionM: 12.5,
      ubicacionEsValida: true,
      ubicacionPermiso: 'concedido',
      ubicacionServicioActivo: true,
      ubicacionMotivoNoDisponible: null,
      dispositivoPlataforma: 'android',
      dispositivoModelo: 'Moto G54',
      dispositivoVersionSistema: '14',
      versionAplicacion: '2.0.0',
    });
    const datos = datosDelCreate(create);
    expect(datos.fechaHoraFinalizacion).toBeInstanceOf(Date);
    expect(datos.ubicacionCapturadaAt).toBeInstanceOf(Date);
    // El crudo se guarda para auditoría, con los campos de sincronización que
    // el validador estripa.
    expect(String(datos.payloadRaw)).toContain('estadoSincronizacion');
    expect(datos).not.toHaveProperty('elegibilidad');
  });

  it('la ubicación AUSENTE se guarda como NULL, distinta de "no disponible"', async () => {
    const { db, create } = fakeDbConMemoria();

    await ingestEncuestaWithDeps(
      entrada(sinClaves(encuestaCompletaValida(), 'ubicacion')),
      { db },
    );

    const datos = datosDelCreate(create);
    expect(datos.ubicacionDisponible).toBeNull();
    expect(datos.ubicacionPermiso).toBeNull();
    expect(datos.ubicacionServicioActivo).toBeNull();
    expect(datos.ubicacionMotivoNoDisponible).toBeNull();
  });

  it('el encuestador ausente se guarda como NULL, no como cadena vacía', async () => {
    // Registro capturado por una app anterior al campo: la columna queda en
    // NULL y el revisor ve el hueco, no un nombre inventado.
    const { db, create } = fakeDbConMemoria();

    await ingestEncuestaWithDeps(
      entrada(sinClaves(encuestaCompletaValida(), 'encuestador')),
      { db },
    );

    expect(datosDelCreate(create).encuestador).toBeNull();
  });

  it('aprobacionPorGobernante se almacena en el orden del catálogo, no en el del teléfono', async () => {
    // Mismo reordenado que aplica el hash canónico. Fijarlo en la columna es lo
    // que permite pivotear el CSV sin ordenar al exportar.
    const desordenada = conRespuestas({
      aprobacionPorGobernante: [
        { gobernante: 'huerta', calificacion: 'mala' },
        { gobernante: 'sheinbaum', calificacion: 'buena' },
        { gobernante: 'jara', calificacion: 'regular' },
      ],
    });
    const { db, create } = fakeDbConMemoria();

    await ingestEncuestaWithDeps(entrada(desordenada), { db });

    const datos = datosDelCreate(create);
    expect(datos.aprobacionPorGobernante).toEqual([
      { gobernante: 'sheinbaum', calificacion: 'buena' },
      { gobernante: 'jara', calificacion: 'regular' },
      { gobernante: 'huerta', calificacion: 'mala' },
    ]);
  });
});

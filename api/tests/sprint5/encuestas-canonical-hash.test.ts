// Hash canónico de la encuesta v1: la mitad sustantiva de la idempotencia. Lo
// que se prueba aquí es la frontera entre "el mismo registro reenviado" (mismo
// hash ⇒ 200 con el idRemoto original) y "otro contenido con el mismo idLocal"
// (hash distinto ⇒ 409). Un falso positivo de cualquiera de los dos lados es un
// bug de datos, no de estilo.

import { describe, expect, it } from 'vitest';

import {
  canonicalizarEncuestaV1,
  hashEncuestaV1,
} from '../../src/lib/encuestasCanonical';
import { encuestaV1Schema } from '../../src/validators/encuestasIngestValidator';
import {
  encuestaCompletaValida,
  encuestaNoElegibleValida,
  sinClaves,
  type PayloadEncuesta,
} from './fixtures';

/** Recorre el camino real: validar (que estripa) y luego hashear lo que quedó. */
function hash(payload: PayloadEncuesta): string {
  return hashEncuestaV1(encuestaV1Schema.parse(payload));
}

function canonico(payload: PayloadEncuesta): string {
  return canonicalizarEncuestaV1(encuestaV1Schema.parse(payload));
}

function conRespuestas(
  sobre: PayloadEncuesta,
  base: PayloadEncuesta = encuestaCompletaValida(),
): PayloadEncuesta {
  return { ...base, respuestas: { ...(base.respuestas as PayloadEncuesta), ...sobre } };
}

const CLAVES_SINCRONIZACION = [
  'estadoSincronizacion',
  'numeroIntentosSincronizacion',
  'fechaUltimoIntento',
  'fechaSincronizacion',
];

describe('canonicalizarEncuestaV1', () => {
  it('emite las claves en un orden fijo por construcción', () => {
    // Si alguien reordena el objeto literal, todos los payloadHash guardados
    // dejan de coincidir y cada reenvío pasaría a ser un 409.
    const objeto = JSON.parse(canonico(encuestaCompletaValida())) as Record<string, unknown>;
    expect(Object.keys(objeto)).toEqual([
      'v',
      'idLocal',
      'folioLocal',
      'versionCuestionario',
      'estado',
      'elegibilidad',
      'fechaHoraInicio',
      'fechaHoraFinalizacion',
      'duracionSegundos',
      'respuestas',
      'ubicacion',
      'dispositivo',
      'versionAplicacion',
    ]);
    expect(objeto.v).toBe(1);
  });

  it('no arrastra nada del transporte', () => {
    const texto = canonico(
      encuestaCompletaValida({
        idRemoto: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
        estadoSincronizacion: 'sincronizada',
      }),
    );
    for (const clave of [...CLAVES_SINCRONIZACION, 'idRemoto']) {
      expect(texto).not.toContain(clave);
    }
  });

  it('normaliza folioLocal ausente y ubicacion ausente a null', () => {
    const objeto = JSON.parse(
      canonico(sinClaves(encuestaCompletaValida(), 'folioLocal', 'ubicacion')),
    ) as Record<string, unknown>;
    expect(objeto.folioLocal).toBeNull();
    expect(objeto.ubicacion).toBeNull();
  });

  it('deja el bloque de respuestas de noElegible reducido a P1', () => {
    const objeto = JSON.parse(canonico(encuestaNoElegibleValida())) as {
      respuestas: Record<string, unknown>;
    };
    expect(objeto.respuestas).toEqual({ credencialVigente: 'no', conocimientoPorPersona: [] });
  });
});

describe('hashEncuestaV1 — lo que NO debe cambiar el hash', () => {
  it('es determinista para el mismo contenido', () => {
    expect(hash(encuestaCompletaValida())).toBe(hash(encuestaCompletaValida()));
    expect(hash(encuestaCompletaValida())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignora los campos de sincronización y el idRemoto del teléfono', () => {
    // Escenario real: el primer POST se pierde por red, el teléfono reintenta con
    // otro contador de intentos y ya con el idRemoto que guardó. Debe dar 200,
    // no 409.
    const primerEnvio = sinClaves(encuestaCompletaValida(), ...CLAVES_SINCRONIZACION);
    const reintento = encuestaCompletaValida({
      idRemoto: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
      estadoSincronizacion: 'sincronizada',
      numeroIntentosSincronizacion: 4,
      fechaUltimoIntento: '2026-07-30T10:09:00.000Z',
      fechaSincronizacion: '2026-07-30T10:10:00.000Z',
    });
    expect(hash(reintento)).toBe(hash(primerEnvio));
  });

  it.each([
    ['sin milisegundos', '2026-07-30T10:00:00Z'],
    ['con offset +00:00', '2026-07-30T10:00:00+00:00'],
    ['con offset -06:00 del mismo instante', '2026-07-30T04:00:00-06:00'],
  ])('ignora la forma en que se escribió la fecha (%s)', (_etiqueta, fecha) => {
    expect(hash(encuestaCompletaValida({ fechaHoraInicio: fecha }))).toBe(
      hash(encuestaCompletaValida()),
    );
  });

  it('ignora el orden de conocimientoPorPersona', () => {
    const base = encuestaCompletaValida();
    const invertido = [
      ...((base.respuestas as PayloadEncuesta).conocimientoPorPersona as unknown[]),
    ].reverse();
    expect(hash(conRespuestas({ conocimientoPorPersona: invertido }))).toBe(hash(base));
  });

  it('ignora el orden de los medios', () => {
    expect(
      hash(
        conRespuestas({
          mediosConocimiento: { tipo: 'respondida', medios: ['labor_social', 'redes_sociales'] },
        }),
      ),
    ).toBe(hash(encuestaCompletaValida()));
  });

  it('trata folioLocal omitido y folioLocal undefined como el mismo dato', () => {
    // No se compara contra `null`: el schema declara el campo .optional() y no
    // .nullable(), así que un null explícito es 422 y nunca llega al hash.
    expect(hash(sinClaves(encuestaCompletaValida(), 'folioLocal'))).toBe(
      hash(encuestaCompletaValida({ folioLocal: undefined })),
    );
  });
});

describe('hashEncuestaV1 — lo que SÍ debe cambiar el hash', () => {
  it('cambia si cambia una respuesta sustantiva', () => {
    expect(hash(conRespuestas({ partidoPreferido: 'pri' }))).not.toBe(
      hash(encuestaCompletaValida()),
    );
  });

  it.each<[string, PayloadEncuesta]>([
    ['folioLocal', { folioLocal: 'LX-9999' }],
    // 420 s sigue dentro de la tolerancia contra el intervalo real (400 s), así
    // que el payload es válido: lo que cambia es el contenido, no su validez.
    ['duracionSegundos', { duracionSegundos: 420 }],
    ['idLocal', { idLocal: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }],
  ])('cambia si cambia %s', (_etiqueta, sobre) => {
    expect(hash(encuestaCompletaValida(sobre))).not.toBe(hash(encuestaCompletaValida()));
  });

  it('cambia si cambia la ubicación, y ausente ≠ presente', () => {
    const base = encuestaCompletaValida();
    const otraUbicacion = encuestaCompletaValida({
      ubicacion: { ...(base.ubicacion as PayloadEncuesta), precisionMetros: 30 },
    });
    expect(hash(otraUbicacion)).not.toBe(hash(base));
    expect(hash(sinClaves(base, 'ubicacion'))).not.toBe(hash(base));
  });

  it('cambia entre completada y noElegible', () => {
    expect(hash(encuestaNoElegibleValida())).not.toBe(hash(encuestaCompletaValida()));
  });

  it('cambia con los metadatos del dispositivo y la versión de la app', () => {
    // Documentado en el plan como riesgo abierto: si la app estampa estos datos
    // al ENVIAR y no al capturar, un reintento tras actualizarse daría 409 y
    // habría que sacarlos del canónico.
    expect(hash(encuestaCompletaValida({ versionAplicacion: '1.0.4' }))).not.toBe(
      hash(encuestaCompletaValida()),
    );
    expect(
      hash(
        encuestaCompletaValida({
          dispositivo: {
            ...(encuestaCompletaValida().dispositivo as PayloadEncuesta),
            modelo: 'Moto G84',
          },
        }),
      ),
    ).not.toBe(hash(encuestaCompletaValida()));
  });
});

// Validador v1 de la ingesta de Encuestas Okrean: catálogos, reglas cruzadas
// entre preguntas, coherencia de la ubicación, fechas/duración y el strip de los
// campos de sincronización. Todo unitario sobre safeParse — sin HTTP ni BD.

import { describe, expect, it } from 'vitest';

import {
  encuestaV1Schema,
  TOLERANCIA_DURACION_SEG,
} from '../../src/validators/encuestasIngestValidator';
import {
  encuestaCompletaValida,
  encuestaNoElegibleValida,
  sinClaves,
  type PayloadEncuesta,
} from './fixtures';

function acepta(payload: PayloadEncuesta): boolean {
  return encuestaV1Schema.safeParse(payload).success;
}

/** Reemplaza campos DENTRO de `respuestas` conservando el resto del bloque. */
function conRespuestas(
  sobre: PayloadEncuesta,
  base: PayloadEncuesta = encuestaCompletaValida(),
): PayloadEncuesta {
  return { ...base, respuestas: { ...(base.respuestas as PayloadEncuesta), ...sobre } };
}

/** Reemplaza campos DENTRO de `ubicacion` conservando el resto del bloque. */
function conUbicacion(
  sobre: PayloadEncuesta,
  base: PayloadEncuesta = encuestaCompletaValida(),
): PayloadEncuesta {
  return { ...base, ubicacion: { ...(base.ubicacion as PayloadEncuesta), ...sobre } };
}

type Conocimiento = { persona: string; nivel: string };

const CONOCIMIENTO_BASE = (encuestaCompletaValida().respuestas as PayloadEncuesta)
  .conocimientoPorPersona as Conocimiento[];

const TODAS_NO_CONOCE: Conocimiento[] = CONOCIMIENTO_BASE.map((f) => ({
  persona: f.persona,
  nivel: 'no_conoce',
}));

describe('encuestaV1Schema — payloads que deben pasar', () => {
  it('acepta una encuesta completada con ubicación disponible', () => {
    const parsed = encuestaV1Schema.safeParse(encuestaCompletaValida());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Las fechas salen como Date; el resto del pipeline (hash, Prisma) cuenta
      // con eso.
      expect(parsed.data.fechaHoraInicio).toBeInstanceOf(Date);
      expect(parsed.data.fechaHoraFinalizacion.toISOString()).toBe('2026-07-30T10:06:40.000Z');
      expect(parsed.data.estado).toBe('completada');
    }
  });

  it('acepta una encuesta noElegible', () => {
    expect(acepta(encuestaNoElegibleValida())).toBe(true);
  });

  it('acepta la ubicación NO disponible con motivo coherente', () => {
    expect(
      acepta(
        conUbicacion({
          disponible: false,
          permiso: 'concedido',
          servicioActivo: true,
          motivoNoDisponible: 'errorTemporal',
        }),
      ),
    ).toBe(true);
  });

  it('acepta la ubicación AUSENTE: registro capturado por una app sin GPS', () => {
    expect(acepta(sinClaves(encuestaCompletaValida(), 'ubicacion'))).toBe(true);
  });

  it('rechaza ubicacion: null — ausente y "vacía" no significan lo mismo', () => {
    expect(acepta(encuestaCompletaValida({ ubicacion: null }))).toBe(false);
  });

  it('acepta P6 omitida por lógica cuando P5 dice que no conoce a nadie', () => {
    expect(
      acepta(
        conRespuestas({
          conocimientoPorPersona: TODAS_NO_CONOCE,
          mediosConocimiento: { tipo: 'omitidaPorLogica' },
        }),
      ),
    ).toBe(true);
  });
});

describe('encuestaV1Schema — catálogos de la versión 1', () => {
  it.each([
    ['partidoPreferido', 'verde_ecologista'],
    ['rangoEdad', '12_17'],
    ['genero', 'no_binario'],
    ['mayorPersonalidad', 'juan_perez'],
    ['candidatoPreferido', 'juan_perez'],
  ])('rechaza %s fuera de catálogo: %s', (campo, valor) => {
    expect(acepta(conRespuestas({ [campo]: valor }))).toBe(false);
  });

  it('rechaza un nivel de conocimiento fuera de catálogo', () => {
    const conocimiento = [
      { persona: 'lalo_ximenez', nivel: 'muchisimo' },
      ...CONOCIMIENTO_BASE.slice(1),
    ];
    expect(acepta(conRespuestas({ conocimientoPorPersona: conocimiento }))).toBe(false);
  });

  it('rechaza un medio fuera de catálogo', () => {
    expect(
      acepta(
        conRespuestas({ mediosConocimiento: { tipo: 'respondida', medios: ['television'] } }),
      ),
    ).toBe(false);
  });

  it('rechaza un estado que no es completada ni noElegible', () => {
    expect(acepta(encuestaCompletaValida({ estado: 'borrador' }))).toBe(false);
  });

  it('rechaza una versión de cuestionario distinta de 1', () => {
    // El router corta antes con UNSUPPORTED_VERSION; el schema es la segunda
    // barrera por si alguien lo usa fuera de esa ruta.
    expect(acepta(encuestaCompletaValida({ versionCuestionario: 2 }))).toBe(false);
  });
});

describe('encuestaV1Schema — P5: las 7 personas', () => {
  it('rechaza que falte una persona (llegan 6)', () => {
    expect(acepta(conRespuestas({ conocimientoPorPersona: CONOCIMIENTO_BASE.slice(0, 6) }))).toBe(
      false,
    );
  });

  it('rechaza 7 filas con una persona repetida', () => {
    const conRepetida = [
      ...CONOCIMIENTO_BASE.slice(0, 6),
      { persona: CONOCIMIENTO_BASE[0].persona, nivel: 'poco' },
    ];
    expect(conRepetida).toHaveLength(7); // el .length(7) no es quien rechaza aquí
    expect(acepta(conRespuestas({ conocimientoPorPersona: conRepetida }))).toBe(false);
  });

  it('rechaza una persona desconocida aunque sean 7 filas', () => {
    const conIntrusa = [
      ...CONOCIMIENTO_BASE.slice(0, 6),
      { persona: 'juan_perez', nivel: 'bien' },
    ];
    expect(acepta(conRespuestas({ conocimientoPorPersona: conIntrusa }))).toBe(false);
  });
});

describe('encuestaV1Schema — coherencia P5 ↔ P6 (en los dos sentidos)', () => {
  it('rechaza medios respondidos cuando P5 dice que no conoce a nadie', () => {
    const parsed = encuestaV1Schema.safeParse(
      conRespuestas({
        conocimientoPorPersona: TODAS_NO_CONOCE,
        mediosConocimiento: { tipo: 'respondida', medios: ['redes_sociales'] },
      }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'respuestas.mediosConocimiento.tipo')).toBe(
        true,
      );
    }
  });

  it('rechaza P6 omitida por lógica cuando P5 sí conoce a alguien', () => {
    expect(acepta(conRespuestas({ mediosConocimiento: { tipo: 'omitidaPorLogica' } }))).toBe(
      false,
    );
  });

  it('rechaza medios repetidos', () => {
    expect(
      acepta(
        conRespuestas({
          mediosConocimiento: {
            tipo: 'respondida',
            medios: ['redes_sociales', 'redes_sociales'],
          },
        }),
      ),
    ).toBe(false);
  });

  it('rechaza la lista de medios vacía: para eso está omitidaPorLogica', () => {
    expect(
      acepta(conRespuestas({ mediosConocimiento: { tipo: 'respondida', medios: [] } })),
    ).toBe(false);
  });
});

describe('encuestaV1Schema — ubicación disponible', () => {
  it.each([
    ['latitud', 91],
    ['latitud', -91],
    ['longitud', -181],
    ['longitud', 181],
  ])('rechaza %s fuera de rango: %s', (campo, valor) => {
    expect(acepta(conUbicacion({ [campo]: valor }))).toBe(false);
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negativa', -1],
    ['NaN', Number.NaN],
  ])('rechaza precisionMetros %s', (_etiqueta, valor) => {
    expect(acepta(conUbicacion({ precisionMetros: valor }))).toBe(false);
  });

  it('rechaza esValida = false con una lectura precisa (10 m)', () => {
    expect(acepta(conUbicacion({ precisionMetros: 10, esValida: false }))).toBe(false);
  });

  it('rechaza esValida = true con una lectura imprecisa (80 m)', () => {
    expect(acepta(conUbicacion({ precisionMetros: 80, esValida: true }))).toBe(false);
  });

  it('acepta esValida = false con una lectura imprecisa (80 m)', () => {
    expect(acepta(conUbicacion({ precisionMetros: 80, esValida: false }))).toBe(true);
  });

  it('rechaza permiso o servicio que contradicen a disponible: true', () => {
    expect(acepta(conUbicacion({ permiso: 'denegado' }))).toBe(false);
    expect(acepta(conUbicacion({ servicioActivo: false }))).toBe(false);
  });
});

describe('encuestaV1Schema — ubicación no disponible', () => {
  const noDisponible = (sobre: PayloadEncuesta) =>
    encuestaCompletaValida({
      ubicacion: {
        disponible: false,
        permiso: 'denegado',
        servicioActivo: true,
        motivoNoDisponible: 'permisoDenegado',
        ...sobre,
      },
    });

  it('rechaza motivo permisoDenegado con el permiso concedido', () => {
    expect(acepta(noDisponible({ permiso: 'concedido' }))).toBe(false);
  });

  it('rechaza motivo servicioDesactivado con el servicio activo', () => {
    expect(
      acepta(noDisponible({ motivoNoDisponible: 'servicioDesactivado', servicioActivo: true })),
    ).toBe(false);
  });

  it('acepta motivo servicioDesactivado con el servicio apagado', () => {
    expect(
      acepta(
        noDisponible({
          permiso: 'concedido',
          motivoNoDisponible: 'servicioDesactivado',
          servicioActivo: false,
        }),
      ),
    ).toBe(true);
  });

  it('con permiso concedido y servicio activo solo admite errorTemporal u omitidaPorEncuestador', () => {
    expect(
      acepta(
        noDisponible({
          permiso: 'concedido',
          servicioActivo: true,
          motivoNoDisponible: 'omitidaPorEncuestador',
        }),
      ),
    ).toBe(true);
  });

  it('rechaza un motivo fuera de catálogo', () => {
    expect(acepta(noDisponible({ motivoNoDisponible: 'se_acabo_la_pila' }))).toBe(false);
  });
});

describe('encuestaV1Schema — fechas y duración', () => {
  it('rechaza que la finalización sea anterior al inicio', () => {
    const parsed = encuestaV1Schema.safeParse(
      encuestaCompletaValida({
        fechaHoraInicio: '2026-07-30T10:06:40.000Z',
        fechaHoraFinalizacion: '2026-07-30T10:00:00.000Z',
        duracionSegundos: 400,
      }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'fechaHoraFinalizacion')).toBe(
        true,
      );
    }
  });

  it.each([
    ['negativa', -1],
    ['no entera', 400.5],
    ['en texto', '400'],
    ['null', null],
  ])('rechaza duracionSegundos %s', (_etiqueta, valor) => {
    expect(acepta(encuestaCompletaValida({ duracionSegundos: valor }))).toBe(false);
  });

  it('rechaza una duración que no concuerda con el intervalo real', () => {
    // El intervalo del fixture es de 400 s; 500 se pasa de la tolerancia.
    const parsed = encuestaV1Schema.safeParse(encuestaCompletaValida({ duracionSegundos: 500 }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'duracionSegundos')).toBe(true);
    }
  });

  it('acepta el desfase justo en la tolerancia y rechaza uno más', () => {
    expect(acepta(encuestaCompletaValida({ duracionSegundos: 400 + TOLERANCIA_DURACION_SEG }))).toBe(
      true,
    );
    expect(
      acepta(encuestaCompletaValida({ duracionSegundos: 400 + TOLERANCIA_DURACION_SEG + 1 })),
    ).toBe(false);
    expect(acepta(encuestaCompletaValida({ duracionSegundos: 400 - TOLERANCIA_DURACION_SEG }))).toBe(
      true,
    );
  });

  it('rechaza una fecha que no es ISO-8601 sin reventar el safeParse', () => {
    expect(acepta(encuestaCompletaValida({ fechaHoraInicio: 'ayer' }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ fechaHoraFinalizacion: 1_753_000_000_000 }))).toBe(
      false,
    );
  });
});

describe('encuestaV1Schema — reglas cruzadas entre ramas', () => {
  it('rechaza completada con elegibilidad noElegible', () => {
    expect(acepta(encuestaCompletaValida({ elegibilidad: 'noElegible' }))).toBe(false);
  });

  it('rechaza noElegible con elegibilidad elegible', () => {
    expect(acepta(encuestaNoElegibleValida({ elegibilidad: 'elegible' }))).toBe(false);
  });

  it('rechaza completada con la credencial en "no"', () => {
    expect(acepta(conRespuestas({ credencialVigente: 'no' }))).toBe(false);
  });

  it('rechaza noElegible con la credencial en "si"', () => {
    expect(
      acepta(
        conRespuestas(
          { credencialVigente: 'si', conocimientoPorPersona: [] },
          encuestaNoElegibleValida(),
        ),
      ),
    ).toBe(false);
  });

  it('rechaza noElegible con conocimientoPorPersona no vacío', () => {
    expect(
      acepta(
        conRespuestas({ conocimientoPorPersona: CONOCIMIENTO_BASE }, encuestaNoElegibleValida()),
      ),
    ).toBe(false);
  });
});

describe('encuestaV1Schema — identidad y números estrictos', () => {
  it.each([
    ['texto libre', 'no-es-uuid'],
    ['uuid truncado', '3f2504e0-4f89-41d3-9a0c'],
    ['vacío', ''],
    ['número', 42],
  ])('rechaza idLocal %s', (_etiqueta, valor) => {
    expect(acepta(encuestaCompletaValida({ idLocal: valor }))).toBe(false);
  });

  it.each(['XX-1', 'LX-', 'lx-1', 'LX-12A', ''])('rechaza folioLocal inválido: %s', (folio) => {
    expect(acepta(encuestaCompletaValida({ folioLocal: folio }))).toBe(false);
  });

  it('acepta folioLocal ausente y rechaza folioLocal null', () => {
    expect(acepta(sinClaves(encuestaCompletaValida(), 'folioLocal'))).toBe(true);
    // Documentado: el campo es .optional() (no .nullable()), así que un null
    // explícito del teléfono es 422. Si la app mandara null en vez de omitir la
    // clave, habría que añadir .nullable() y normalizar a undefined.
    expect(acepta(encuestaCompletaValida({ folioLocal: null }))).toBe(false);
  });

  it('acepta encuestador y también su AUSENCIA, en las dos ramas', () => {
    // Es opcional por retrocompatibilidad: las encuestas ya capturadas en los
    // teléfonos antes de actualizar la app no lo traen.
    expect(acepta(encuestaCompletaValida())).toBe(true);
    expect(acepta(encuestaNoElegibleValida())).toBe(true);
    expect(acepta(sinClaves(encuestaCompletaValida(), 'encuestador'))).toBe(true);
    expect(acepta(sinClaves(encuestaNoElegibleValida(), 'encuestador'))).toBe(true);
  });

  it('rechaza encuestador null, vacío, en blanco o de más de 120 caracteres', () => {
    // Igual que folioLocal: el campo es .optional() y NO .nullable(), así que
    // "no lo sé" se expresa omitiendo la clave, nunca mandando null.
    expect(acepta(encuestaCompletaValida({ encuestador: null }))).toBe(false);
    expect(acepta(encuestaNoElegibleValida({ encuestador: null }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ encuestador: '' }))).toBe(false);
    // Se recorta antes de medir, así que solo espacios tampoco cuenta.
    expect(acepta(encuestaCompletaValida({ encuestador: '   ' }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ encuestador: 'a'.repeat(120) }))).toBe(true);
    expect(acepta(encuestaCompletaValida({ encuestador: 'a'.repeat(121) }))).toBe(false);
  });

  it('no coerciona nada: JSON puro exige tipos exactos', () => {
    expect(acepta(conUbicacion({ latitud: '19.432608' }))).toBe(false);
    expect(acepta(conUbicacion({ esValida: 'true' }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ versionCuestionario: '1' }))).toBe(false);
    const dispositivo = encuestaCompletaValida().dispositivo as PayloadEncuesta;
    expect(acepta(encuestaCompletaValida({ dispositivo: { ...dispositivo, modelo: '   ' } }))).toBe(
      false,
    );
  });
});

describe('encuestaV1Schema — strip de lo que no es la encuesta', () => {
  it('descarta los campos de sincronización y el idRemoto del teléfono', () => {
    const parsed = encuestaV1Schema.safeParse(
      encuestaCompletaValida({
        idRemoto: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
        estadoSincronizacion: 'sincronizada',
        numeroIntentosSincronizacion: 3,
        fechaUltimoIntento: '2026-07-30T10:07:00.000Z',
        fechaSincronizacion: '2026-07-30T10:08:00.000Z',
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as unknown as PayloadEncuesta;
      expect(data).not.toHaveProperty('estadoSincronizacion');
      expect(data).not.toHaveProperty('numeroIntentosSincronizacion');
      expect(data).not.toHaveProperty('fechaUltimoIntento');
      expect(data).not.toHaveProperty('fechaSincronizacion');
      expect(data).not.toHaveProperty('idRemoto');
    }
  });

  it('descarta P2–P8 en la rama noElegible aunque el teléfono las mande', () => {
    const parsed = encuestaV1Schema.safeParse(
      conRespuestas(
        {
          rangoEdad: '30_44',
          genero: 'mujer',
          partidoPreferido: 'morena',
          mediosConocimiento: { tipo: 'respondida', medios: ['redes_sociales'] },
          mayorPersonalidad: 'lalo_ximenez',
          candidatoPreferido: 'laura_estrada',
        },
        encuestaNoElegibleValida(),
      ),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data.respuestas).sort()).toEqual([
        'conocimientoPorPersona',
        'credencialVigente',
      ]);
    }
  });
});

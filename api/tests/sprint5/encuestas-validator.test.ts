import { describe, expect, it } from 'vitest';
import {
  encuestaV1Schema,
  encuestaV3Schema,
  GOBERNANTES_V3,
  TOLERANCIA_DURACION_SEG,
} from '../../src/validators/encuestasIngestValidator';
import {
  encuestaCompletaValida,
  encuestaV1CompletaValida,
  encuestaV1NoElegibleValida,
  sinClaves,
  type PayloadEncuesta,
} from './fixtures';

/** Payload con el sub-objeto respuestas parcheado (el merge del fixture es superficial). */
function conRespuestas(cambios: Record<string, unknown>): PayloadEncuesta {
  const base = encuestaCompletaValida();
  return { ...base, respuestas: { ...(base.respuestas as Record<string, unknown>), ...cambios } };
}

/** Reemplaza campos DENTRO de `ubicacion` conservando el resto del bloque. */
function conUbicacion(
  sobre: PayloadEncuesta,
  base: PayloadEncuesta = encuestaCompletaValida(),
): PayloadEncuesta {
  return { ...base, ubicacion: { ...(base.ubicacion as PayloadEncuesta), ...sobre } };
}

function issuesDe(payload: PayloadEncuesta): string[] {
  const r = encuestaV3Schema.safeParse(payload);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

function acepta(payload: PayloadEncuesta): boolean {
  return encuestaV3Schema.safeParse(payload).success;
}

describe('encuestaV3Schema — aceptación', () => {
  it('acepta el payload v3 completo y estripa los campos de la cola del teléfono', () => {
    const r = encuestaV3Schema.safeParse(encuestaCompletaValida());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty('estadoSincronizacion');
    expect(r.data).not.toHaveProperty('fechaSincronizacion');
  });

  it('estripa una clave elegibilidad enviada por una app vieja', () => {
    const r = encuestaV3Schema.safeParse(encuestaCompletaValida({ elegibilidad: 'elegible' }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty('elegibilidad');
  });

  it('acepta empresariosConocidos vacío (0–3) y recorta espacios', () => {
    const r = encuestaV3Schema.safeParse(
      conRespuestas({ empresariosConocidos: [], politicosConocidos: ['  Irineo Molina  '] }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.respuestas.politicosConocidos).toEqual(['Irineo Molina']);
  });

  it('acepta ubicacion AUSENTE pero no null', () => {
    expect(encuestaV3Schema.safeParse(sinClaves(encuestaCompletaValida(), 'ubicacion')).success).toBe(true);
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({ ubicacion: null })).success).toBe(false);
  });
});

describe('encuestaV3Schema — catálogos', () => {
  // Un caso inválido por catálogo; los valores v1 quedan explícitamente fuera.
  const fueraDeCatalogo: Array<[string, Record<string, unknown>]> = [
    ['sexo', { sexo: 'otro' }],
    ['rangoEdad', { rangoEdad: '30_44' }],
    ['conoceLalo', { conoceLalo: 'tal_vez' }],
    ['rolLalo', { rolLalo: 'diputado' }],
    ['opinionLalo', { opinionLalo: 'excelente' }],
    ['preferenciaElectoral', { preferenciaElectoral: 'laura_estrada' }],
    ['preferenciaPartido', { preferenciaPartido: 'prd' }],
  ];
  for (const [campo, cambio] of fueraDeCatalogo) {
    it(`rechaza ${campo} fuera del catálogo v3`, () => {
      expect(issuesDe(conRespuestas(cambio))).toContain(`respuestas.${campo}`);
    });
  }

  it('rechaza cada campo de respuestas ausente (todos obligatorios)', () => {
    const campos = [
      'sexo', 'rangoEdad', 'empresariosConocidos', 'politicosConocidos', 'conoceLalo',
      'rolLalo', 'opinionLalo', 'preferenciaElectoral', 'preferenciaPartido',
      'aprobacionPorGobernante',
    ];
    for (const campo of campos) {
      const base = encuestaCompletaValida();
      const respuestas = { ...(base.respuestas as Record<string, unknown>) };
      delete respuestas[campo];
      expect(encuestaV3Schema.safeParse({ ...base, respuestas }).success, campo).toBe(false);
    }
  });
});

describe('encuestaV3Schema — listas de texto libre', () => {
  it('rechaza politicosConocidos vacío (mínimo 1)', () => {
    expect(issuesDe(conRespuestas({ politicosConocidos: [] }))).toContain('respuestas.politicosConocidos');
  });
  it('rechaza más de 3 entradas', () => {
    expect(encuestaV3Schema.safeParse(conRespuestas({ empresariosConocidos: ['a', 'b', 'c', 'd'] })).success).toBe(false);
  });
  it('rechaza entradas de más de 80 caracteres, vacías tras trim, o no-string', () => {
    expect(encuestaV3Schema.safeParse(conRespuestas({ politicosConocidos: ['x'.repeat(81)] })).success).toBe(false);
    expect(encuestaV3Schema.safeParse(conRespuestas({ politicosConocidos: ['   '] })).success).toBe(false);
    expect(encuestaV3Schema.safeParse(conRespuestas({ politicosConocidos: [42] })).success).toBe(false);
  });
});

describe('encuestaV3Schema — aprobacionPorGobernante', () => {
  it('exige exactamente 3 filas', () => {
    expect(encuestaV3Schema.safeParse(conRespuestas({
      aprobacionPorGobernante: [{ gobernante: 'sheinbaum', calificacion: 'buena' }],
    })).success).toBe(false);
  });
  it('rechaza gobernantes repetidos', () => {
    expect(encuestaV3Schema.safeParse(conRespuestas({
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'buena' },
        { gobernante: 'sheinbaum', calificacion: 'mala' },
        { gobernante: 'jara', calificacion: 'regular' },
      ],
    })).success).toBe(false);
  });
  it('rechaza calificaciones fuera de catálogo (no_lo_conozco solo existe en opinionLalo)', () => {
    expect(encuestaV3Schema.safeParse(conRespuestas({
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'no_lo_conozco' },
        { gobernante: 'jara', calificacion: 'regular' },
        { gobernante: 'huerta', calificacion: 'mala' },
      ],
    })).success).toBe(false);
  });
  it('acepta los 3 gobernantes en cualquier orden', () => {
    expect(encuestaV3Schema.safeParse(conRespuestas({
      aprobacionPorGobernante: [
        { gobernante: 'huerta', calificacion: 'mala' },
        { gobernante: 'sheinbaum', calificacion: 'buena' },
        { gobernante: 'jara', calificacion: 'regular' },
      ],
    })).success).toBe(true);
    expect(GOBERNANTES_V3).toEqual(['sheinbaum', 'jara', 'huerta']);
  });
});

describe('encuestaV3Schema — ubicación disponible', () => {
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

describe('encuestaV3Schema — ubicación no disponible', () => {
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

describe('encuestaV3Schema — fechas y duración', () => {
  it('rechaza que la finalización sea anterior al inicio', () => {
    const parsed = encuestaV3Schema.safeParse(
      encuestaCompletaValida({
        fechaHoraInicio: '2026-08-01T10:06:40.000Z',
        fechaHoraFinalizacion: '2026-08-01T10:00:00.000Z',
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
    const parsed = encuestaV3Schema.safeParse(encuestaCompletaValida({ duracionSegundos: 500 }));
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

describe('encuestaV3Schema — identidad y números estrictos', () => {
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
    expect(acepta(encuestaCompletaValida({ folioLocal: null }))).toBe(false);
  });

  it('acepta encuestador y también su AUSENCIA', () => {
    expect(acepta(encuestaCompletaValida())).toBe(true);
    expect(acepta(sinClaves(encuestaCompletaValida(), 'encuestador'))).toBe(true);
  });

  it('rechaza encuestador null, vacío, en blanco o de más de 120 caracteres', () => {
    expect(acepta(encuestaCompletaValida({ encuestador: null }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ encuestador: '' }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ encuestador: '   ' }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ encuestador: 'a'.repeat(120) }))).toBe(true);
    expect(acepta(encuestaCompletaValida({ encuestador: 'a'.repeat(121) }))).toBe(false);
  });

  it('no coerciona nada: JSON puro exige tipos exactos', () => {
    expect(acepta(conUbicacion({ latitud: '19.432608' }))).toBe(false);
    expect(acepta(conUbicacion({ esValida: 'true' }))).toBe(false);
    expect(acepta(encuestaCompletaValida({ versionCuestionario: '3' }))).toBe(false);
    const dispositivo = encuestaCompletaValida().dispositivo as PayloadEncuesta;
    expect(acepta(encuestaCompletaValida({ dispositivo: { ...dispositivo, modelo: '   ' } }))).toBe(
      false,
    );
  });
});

describe('encuestaV3Schema — registro', () => {
  it('rechaza versionCuestionario ≠ 3 y estado ≠ completada', () => {
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({ versionCuestionario: 1 })).success).toBe(false);
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({ estado: 'noElegible' })).success).toBe(false);
  });
  it('rechaza números como texto (sin coerce)', () => {
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({ duracionSegundos: '400' })).success).toBe(false);
  });
  it('rechaza fin anterior al inicio y duración fuera de tolerancia', () => {
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({
      fechaHoraFinalizacion: '2026-08-01T09:00:00.000Z',
    })).success).toBe(false);
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({
      duracionSegundos: 400 + TOLERANCIA_DURACION_SEG + 1,
    })).success).toBe(false);
  });
  it('rechaza encuestador null pero acepta la clave ausente', () => {
    expect(encuestaV3Schema.safeParse(encuestaCompletaValida({ encuestador: null })).success).toBe(false);
    expect(encuestaV3Schema.safeParse(sinClaves(encuestaCompletaValida(), 'encuestador', 'folioLocal')).success).toBe(true);
  });
  it('revalida esValida contra precisionMetros (no se cree al teléfono)', () => {
    const base = encuestaCompletaValida();
    const ubicacion = { ...(base.ubicacion as Record<string, unknown>), precisionMetros: 200, esValida: true };
    expect(encuestaV3Schema.safeParse({ ...base, ubicacion }).success).toBe(false);
  });
});

describe('encuestaV3Schema — strip de lo que no es la encuesta', () => {
  it('descarta los campos de sincronización y el idRemoto del teléfono', () => {
    const parsed = encuestaV3Schema.safeParse(
      encuestaCompletaValida({
        idRemoto: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
        estadoSincronizacion: 'sincronizada',
        numeroIntentosSincronizacion: 3,
        fechaUltimoIntento: '2026-08-01T10:07:00.000Z',
        fechaSincronizacion: '2026-08-01T10:08:00.000Z',
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
});

// ---------------------------------------------------------------------------
// Cuestionario v1 (restaurado)
// ---------------------------------------------------------------------------
// El servidor vuelve a aceptar el v1 JUNTO al v3, así que los dos schemas
// conviven en este archivo. Lo que NO se re-prueba aquí es la ubicación: v1
// reutiliza el MISMO ubicacionSchema que los describe de arriba ya ejercitan.

describe('encuestaV1Schema (cuestionario restaurado)', () => {
  function aceptaV1(payload: PayloadEncuesta): boolean {
    return encuestaV1Schema.safeParse(payload).success;
  }

  /** Reemplaza campos DENTRO de `respuestas` conservando el resto del bloque. */
  function conRespuestasV1(
    sobre: PayloadEncuesta,
    base: PayloadEncuesta = encuestaV1CompletaValida(),
  ): PayloadEncuesta {
    return { ...base, respuestas: { ...(base.respuestas as PayloadEncuesta), ...sobre } };
  }

  type Conocimiento = { persona: string; nivel: string };

  const CONOCIMIENTO_BASE = (encuestaV1CompletaValida().respuestas as PayloadEncuesta)
    .conocimientoPorPersona as Conocimiento[];

  const TODAS_NO_CONOCE: Conocimiento[] = CONOCIMIENTO_BASE.map((f) => ({
    persona: f.persona,
    nivel: 'no_conoce',
  }));

  describe('payloads que deben pasar', () => {
    it('acepta una encuesta completada con ubicación disponible', () => {
      const parsed = encuestaV1Schema.safeParse(encuestaV1CompletaValida());
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
      expect(aceptaV1(encuestaV1NoElegibleValida())).toBe(true);
    });

    it('acepta P6 omitida por lógica cuando P5 dice que no conoce a nadie', () => {
      expect(
        aceptaV1(
          conRespuestasV1({
            conocimientoPorPersona: TODAS_NO_CONOCE,
            mediosConocimiento: { tipo: 'omitidaPorLogica' },
          }),
        ),
      ).toBe(true);
    });
  });

  describe('catálogos de la versión 1', () => {
    it.each([
      ['partidoPreferido', 'verde_ecologista'],
      ['rangoEdad', '12_17'],
      ['genero', 'no_binario'],
      ['mayorPersonalidad', 'juan_perez'],
      ['candidatoPreferido', 'juan_perez'],
    ])('rechaza %s fuera de catálogo: %s', (campo, valor) => {
      expect(aceptaV1(conRespuestasV1({ [campo]: valor }))).toBe(false);
    });

    it('rechaza el rangoEdad de la v3: los catálogos son disjuntos', () => {
      expect(aceptaV1(conRespuestasV1({ rangoEdad: '31_45' }))).toBe(false);
    });

    it('rechaza un nivel de conocimiento fuera de catálogo', () => {
      const conocimiento = [
        { persona: 'lalo_ximenez', nivel: 'muchisimo' },
        ...CONOCIMIENTO_BASE.slice(1),
      ];
      expect(aceptaV1(conRespuestasV1({ conocimientoPorPersona: conocimiento }))).toBe(false);
    });

    it('rechaza un medio fuera de catálogo', () => {
      expect(
        aceptaV1(
          conRespuestasV1({ mediosConocimiento: { tipo: 'respondida', medios: ['television'] } }),
        ),
      ).toBe(false);
    });

    it('rechaza un estado que no es completada ni noElegible', () => {
      expect(aceptaV1(encuestaV1CompletaValida({ estado: 'borrador' }))).toBe(false);
    });

    it('rechaza una versión de cuestionario distinta de 1', () => {
      // El router corta antes con UNSUPPORTED_VERSION; el schema es la segunda
      // barrera por si alguien lo usa fuera de esa ruta. El 3 importa aparte: es
      // el literal que trae camposComunes y que las ramas v1 sobrescriben.
      expect(aceptaV1(encuestaV1CompletaValida({ versionCuestionario: 2 }))).toBe(false);
      expect(aceptaV1(encuestaV1CompletaValida({ versionCuestionario: 3 }))).toBe(false);
    });
  });

  describe('P5: las 7 personas', () => {
    it('rechaza que falte una persona (llegan 6)', () => {
      expect(
        aceptaV1(conRespuestasV1({ conocimientoPorPersona: CONOCIMIENTO_BASE.slice(0, 6) })),
      ).toBe(false);
    });

    it('rechaza 7 filas con una persona repetida', () => {
      const conRepetida = [
        ...CONOCIMIENTO_BASE.slice(0, 6),
        { persona: CONOCIMIENTO_BASE[0].persona, nivel: 'poco' },
      ];
      expect(conRepetida).toHaveLength(7); // el .length(7) no es quien rechaza aquí
      expect(aceptaV1(conRespuestasV1({ conocimientoPorPersona: conRepetida }))).toBe(false);
    });

    it('rechaza una persona desconocida aunque sean 7 filas', () => {
      const conIntrusa = [
        ...CONOCIMIENTO_BASE.slice(0, 6),
        { persona: 'juan_perez', nivel: 'bien' },
      ];
      expect(aceptaV1(conRespuestasV1({ conocimientoPorPersona: conIntrusa }))).toBe(false);
    });
  });

  describe('coherencia P5 ↔ P6 (en los dos sentidos)', () => {
    it('rechaza medios respondidos cuando P5 dice que no conoce a nadie', () => {
      const parsed = encuestaV1Schema.safeParse(
        conRespuestasV1({
          conocimientoPorPersona: TODAS_NO_CONOCE,
          mediosConocimiento: { tipo: 'respondida', medios: ['redes_sociales'] },
        }),
      );
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (i) => i.path.join('.') === 'respuestas.mediosConocimiento.tipo',
          ),
        ).toBe(true);
      }
    });

    it('rechaza P6 omitida por lógica cuando P5 sí conoce a alguien', () => {
      expect(aceptaV1(conRespuestasV1({ mediosConocimiento: { tipo: 'omitidaPorLogica' } }))).toBe(
        false,
      );
    });

    it('rechaza medios repetidos', () => {
      expect(
        aceptaV1(
          conRespuestasV1({
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
        aceptaV1(conRespuestasV1({ mediosConocimiento: { tipo: 'respondida', medios: [] } })),
      ).toBe(false);
    });
  });

  describe('reglas cruzadas entre ramas', () => {
    it('rechaza completada con elegibilidad noElegible', () => {
      expect(aceptaV1(encuestaV1CompletaValida({ elegibilidad: 'noElegible' }))).toBe(false);
    });

    it('rechaza noElegible con elegibilidad elegible', () => {
      expect(aceptaV1(encuestaV1NoElegibleValida({ elegibilidad: 'elegible' }))).toBe(false);
    });

    it('rechaza completada con la credencial en "no"', () => {
      expect(aceptaV1(conRespuestasV1({ credencialVigente: 'no' }))).toBe(false);
    });

    it('rechaza noElegible con la credencial en "si"', () => {
      expect(
        aceptaV1(
          conRespuestasV1(
            { credencialVigente: 'si', conocimientoPorPersona: [] },
            encuestaV1NoElegibleValida(),
          ),
        ),
      ).toBe(false);
    });

    it('rechaza noElegible con conocimientoPorPersona no vacío', () => {
      expect(
        aceptaV1(
          conRespuestasV1(
            { conocimientoPorPersona: CONOCIMIENTO_BASE },
            encuestaV1NoElegibleValida(),
          ),
        ),
      ).toBe(false);
    });
  });

  describe('fechas y duración', () => {
    it('rechaza que la finalización sea anterior al inicio', () => {
      const parsed = encuestaV1Schema.safeParse(
        encuestaV1CompletaValida({
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
      expect(aceptaV1(encuestaV1CompletaValida({ duracionSegundos: valor }))).toBe(false);
    });

    it('rechaza una duración que no concuerda con el intervalo real', () => {
      // El intervalo del fixture es de 400 s; 500 se pasa de la tolerancia.
      const parsed = encuestaV1Schema.safeParse(
        encuestaV1CompletaValida({ duracionSegundos: 500 }),
      );
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path.join('.') === 'duracionSegundos')).toBe(true);
      }
    });

    it('acepta el desfase justo en la tolerancia y rechaza uno más', () => {
      expect(
        aceptaV1(encuestaV1CompletaValida({ duracionSegundos: 400 + TOLERANCIA_DURACION_SEG })),
      ).toBe(true);
      expect(
        aceptaV1(encuestaV1CompletaValida({ duracionSegundos: 400 + TOLERANCIA_DURACION_SEG + 1 })),
      ).toBe(false);
      expect(
        aceptaV1(encuestaV1CompletaValida({ duracionSegundos: 400 - TOLERANCIA_DURACION_SEG })),
      ).toBe(true);
    });

    it('rechaza una fecha que no es ISO-8601 sin reventar el safeParse', () => {
      expect(aceptaV1(encuestaV1CompletaValida({ fechaHoraInicio: 'ayer' }))).toBe(false);
      expect(aceptaV1(encuestaV1CompletaValida({ fechaHoraFinalizacion: 1_753_000_000_000 }))).toBe(
        false,
      );
    });
  });

  describe('strip de lo que no es la encuesta', () => {
    it('descarta P2–P8 en la rama noElegible aunque el teléfono las mande', () => {
      const parsed = encuestaV1Schema.safeParse(
        conRespuestasV1(
          {
            rangoEdad: '30_44',
            genero: 'mujer',
            partidoPreferido: 'morena',
            mediosConocimiento: { tipo: 'respondida', medios: ['redes_sociales'] },
            mayorPersonalidad: 'lalo_ximenez',
            candidatoPreferido: 'laura_estrada',
          },
          encuestaV1NoElegibleValida(),
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
});

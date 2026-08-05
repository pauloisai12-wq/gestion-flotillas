import { describe, expect, it } from 'vitest';
import {
  encuestaV3Schema,
  GOBERNANTES_V3,
  TOLERANCIA_DURACION_SEG,
} from '../../src/validators/encuestasIngestValidator';
import { encuestaCompletaValida, sinClaves, type PayloadEncuesta } from './fixtures';

/** Payload con el sub-objeto respuestas parcheado (el merge del fixture es superficial). */
function conRespuestas(cambios: Record<string, unknown>): PayloadEncuesta {
  const base = encuestaCompletaValida();
  return { ...base, respuestas: { ...(base.respuestas as Record<string, unknown>), ...cambios } };
}

function issuesDe(payload: PayloadEncuesta): string[] {
  const r = encuestaV3Schema.safeParse(payload);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
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

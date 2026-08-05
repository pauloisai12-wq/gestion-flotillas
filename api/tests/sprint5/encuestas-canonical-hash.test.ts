import { describe, expect, it } from 'vitest';
import { canonicalizarEncuestaV3, hashEncuestaV3 } from '../../src/lib/encuestasCanonical';
import { encuestaV3Schema } from '../../src/validators/encuestasIngestValidator';
import { encuestaCompletaValida, type PayloadEncuesta } from './fixtures';

function hashDe(payload: PayloadEncuesta): string {
  const r = encuestaV3Schema.safeParse(payload);
  if (!r.success) throw new Error('fixture inválido: ' + JSON.stringify(r.error.issues));
  return hashEncuestaV3(r.data);
}

function conRespuestas(cambios: Record<string, unknown>): PayloadEncuesta {
  const base = encuestaCompletaValida();
  return { ...base, respuestas: { ...(base.respuestas as Record<string, unknown>), ...cambios } };
}

describe('hashEncuestaV3', () => {
  it('es estable ante el reorden de aprobacionPorGobernante (es un conjunto)', () => {
    const reordenada = conRespuestas({
      aprobacionPorGobernante: [
        { gobernante: 'huerta', calificacion: 'mala' },
        { gobernante: 'jara', calificacion: 'regular' },
        { gobernante: 'sheinbaum', calificacion: 'buena' },
      ],
    });
    expect(hashDe(reordenada)).toBe(hashDe(encuestaCompletaValida()));
  });

  it('cambia si cambia una calificación', () => {
    const distinta = conRespuestas({
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'muy_mala' },
        { gobernante: 'jara', calificacion: 'regular' },
        { gobernante: 'huerta', calificacion: 'mala' },
      ],
    });
    expect(hashDe(distinta)).not.toBe(hashDe(encuestaCompletaValida()));
  });

  it('SÍ distingue el orden de las listas de texto libre (no son catálogo)', () => {
    const base = conRespuestas({ politicosConocidos: ['A', 'B'] });
    const invertida = conRespuestas({ politicosConocidos: ['B', 'A'] });
    expect(hashDe(base)).not.toBe(hashDe(invertida));
  });

  it('normaliza formatos de fecha equivalentes', () => {
    const otroFormato = encuestaCompletaValida({ fechaHoraInicio: '2026-08-01T10:00:00+00:00' });
    expect(hashDe(otroFormato)).toBe(hashDe(encuestaCompletaValida()));
  });

  it('ignora los campos de la cola de envío del teléfono', () => {
    const reintento = encuestaCompletaValida({ estadoSincronizacion: 'reintentando', numeroIntentosSincronizacion: 7 });
    expect(hashDe(reintento)).toBe(hashDe(encuestaCompletaValida()));
  });

  it('trata folioLocal/encuestador/ubicacion ausentes como null', () => {
    const sin = encuestaCompletaValida();
    delete (sin as Record<string, unknown>).folioLocal;
    const conNull = canonicalizarEncuestaV3(encuestaV3Schema.parse(sin));
    expect(conNull).toContain('"folioLocal":null');
  });

  it('declara la versión 2 del algoritmo canónico', () => {
    expect(canonicalizarEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida()))).toContain('"v":2');
  });
});

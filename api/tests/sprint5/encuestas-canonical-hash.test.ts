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

describe('canonicalizarEncuestaV3 — estructura', () => {
  it('emite las claves en un orden fijo por construcción', () => {
    // Si alguien reordena el objeto literal, todos los payloadHash guardados
    // dejan de coincidir y cada reenvío pasaría a ser un 409.
    const canónico = canonicalizarEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida()));
    const objeto = JSON.parse(canónico) as Record<string, unknown>;
    expect(Object.keys(objeto)).toEqual([
      'v',
      'idLocal',
      'folioLocal',
      'encuestador',
      'versionCuestionario',
      'estado',
      'fechaHoraInicio',
      'fechaHoraFinalizacion',
      'duracionSegundos',
      'respuestas',
      'ubicacion',
      'dispositivo',
      'versionAplicacion',
    ]);
    expect(objeto.v).toBe(2);
  });

  it('emite las respuestas en un orden fijo por construcción', () => {
    const canónico = canonicalizarEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida()));
    const objeto = JSON.parse(canónico) as Record<string, unknown>;
    const respuestas = objeto.respuestas as Record<string, unknown>;
    expect(Object.keys(respuestas)).toEqual([
      'sexo',
      'rangoEdad',
      'empresariosConocidos',
      'politicosConocidos',
      'conoceLalo',
      'rolLalo',
      'opinionLalo',
      'preferenciaElectoral',
      'preferenciaPartido',
      'aprobacionPorGobernante',
    ]);
  });

  it('no incluye elegibilidad ni idRemoto', () => {
    const canónico = canonicalizarEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida()));
    expect(canónico).not.toContain('elegibilidad');
    expect(canónico).not.toContain('idRemoto');
  });

  it('trata folioLocal, encuestador y ubicacion ausentes como null', () => {
    const sin = encuestaCompletaValida();
    delete (sin as Record<string, unknown>).folioLocal;
    delete (sin as Record<string, unknown>).encuestador;
    delete (sin as Record<string, unknown>).ubicacion;
    const canónico = canonicalizarEncuestaV3(encuestaV3Schema.parse(sin));
    const objeto = JSON.parse(canónico) as Record<string, unknown>;
    expect(objeto.folioLocal).toBeNull();
    expect(objeto.encuestador).toBeNull();
    expect(objeto.ubicacion).toBeNull();
    expect(canónico).toContain('"folioLocal":null');
    expect(canónico).toContain('"encuestador":null');
    expect(canónico).toContain('"ubicacion":null');
  });
});

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

  it('es determinista y emite formato sha256 hex', () => {
    const h = hashEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida()));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida())));
  });

  it('declara la versión 2 del algoritmo canónico', () => {
    expect(canonicalizarEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida()))).toContain('"v":2');
  });
});

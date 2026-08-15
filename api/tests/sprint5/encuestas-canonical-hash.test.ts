import { describe, expect, it } from 'vitest';
import {
  canonicalizarEncuestaV1,
  canonicalizarEncuestaV3,
  canonicalizarEncuestaV4,
  hashEncuestaV1,
  hashEncuestaV3,
  hashEncuestaV4,
} from '../../src/lib/encuestasCanonical';
import {
  encuestaV1Schema,
  encuestaV3Schema,
  encuestaV4Schema,
} from '../../src/validators/encuestasIngestValidator';
import {
  encuestaCompletaValida,
  encuestaV1CompletaValida,
  encuestaV1NoElegibleValida,
  encuestaV4CompletaValida,
  sinClaves,
  type PayloadEncuesta,
} from './fixtures';

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

// El v1 convive con el v3: los registros v1 ya guardados tienen que seguir dando
// el MISMO payloadHash que antes del reemplazo, así que su canónico conserva su
// propia versión (`v:1`) y su propio orden de claves. Cada canonicalizador es
// independiente del otro.

/** Recorre el camino real del v1: validar (que estripa) y luego hashear. */
function hashV1De(payload: PayloadEncuesta): string {
  const r = encuestaV1Schema.safeParse(payload);
  if (!r.success) throw new Error('fixture v1 inválido: ' + JSON.stringify(r.error.issues));
  return hashEncuestaV1(r.data);
}

function canonicoV1(payload: PayloadEncuesta): string {
  return canonicalizarEncuestaV1(encuestaV1Schema.parse(payload));
}

function conRespuestasV1(cambios: Record<string, unknown>): PayloadEncuesta {
  const base = encuestaV1CompletaValida();
  return { ...base, respuestas: { ...(base.respuestas as Record<string, unknown>), ...cambios } };
}

const CLAVES_SINCRONIZACION = [
  'estadoSincronizacion',
  'numeroIntentosSincronizacion',
  'fechaUltimoIntento',
  'fechaSincronizacion',
];

describe('canonicalización v1 (restaurada)', () => {
  it('emite las claves en un orden fijo por construcción', () => {
    // Si alguien reordena el objeto literal, todos los payloadHash guardados
    // dejan de coincidir y cada reenvío pasaría a ser un 409.
    const objeto = JSON.parse(canonicoV1(encuestaV1CompletaValida())) as Record<string, unknown>;
    expect(Object.keys(objeto)).toEqual([
      'v',
      'idLocal',
      'folioLocal',
      'encuestador',
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

  it('da el mismo hash para el mismo contenido', () => {
    expect(hashV1De(encuestaV1CompletaValida())).toBe(hashV1De(encuestaV1CompletaValida()));
    expect(hashV1De(encuestaV1CompletaValida())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignora el orden de conocimientoPorPersona (es un conjunto)', () => {
    const base = encuestaV1CompletaValida();
    const invertido = [
      ...((base.respuestas as Record<string, unknown>).conocimientoPorPersona as unknown[]),
    ].reverse();
    expect(hashV1De(conRespuestasV1({ conocimientoPorPersona: invertido }))).toBe(hashV1De(base));
  });

  it('ignora el orden de los medios (también es un conjunto)', () => {
    const reordenados = conRespuestasV1({
      mediosConocimiento: { tipo: 'respondida', medios: ['labor_social', 'redes_sociales'] },
    });
    expect(hashV1De(reordenados)).toBe(hashV1De(encuestaV1CompletaValida()));
  });

  it('cambia si cambia una respuesta sustantiva', () => {
    expect(hashV1De(conRespuestasV1({ partidoPreferido: 'pri' }))).not.toBe(
      hashV1De(encuestaV1CompletaValida()),
    );
  });

  it('ignora los campos de sincronización y el idRemoto del teléfono', () => {
    // Escenario real: el primer POST se pierde por red, el teléfono reintenta con
    // otro contador de intentos y ya con el idRemoto que guardó. Debe dar 200,
    // no 409.
    const primerEnvio = sinClaves(encuestaV1CompletaValida(), ...CLAVES_SINCRONIZACION);
    const reintento = encuestaV1CompletaValida({
      idRemoto: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
      estadoSincronizacion: 'sincronizada',
      numeroIntentosSincronizacion: 4,
      fechaUltimoIntento: '2026-07-30T10:09:00.000Z',
      fechaSincronizacion: '2026-07-30T10:10:00.000Z',
    });
    expect(hashV1De(reintento)).toBe(hashV1De(primerEnvio));
    const texto = canonicoV1(reintento);
    for (const clave of [...CLAVES_SINCRONIZACION, 'idRemoto']) {
      expect(texto).not.toContain(clave);
    }
  });

  it('lleva su propia versión canónica: v1 emite "v":1 y v3 sigue emitiendo "v":2', () => {
    const objeto = JSON.parse(canonicoV1(encuestaV1CompletaValida())) as Record<string, unknown>;
    expect(objeto.v).toBe(1);
    const objetoV3 = JSON.parse(
      canonicalizarEncuestaV3(encuestaV3Schema.parse(encuestaCompletaValida())),
    ) as Record<string, unknown>;
    expect(objetoV3.v).toBe(2);
  });

  it('deja el bloque de respuestas de noElegible reducido a P1', () => {
    const objeto = JSON.parse(canonicoV1(encuestaV1NoElegibleValida())) as {
      respuestas: Record<string, unknown>;
    };
    expect(objeto.respuestas).toEqual({ credencialVigente: 'no', conocimientoPorPersona: [] });
  });
});

describe('hashEncuestaV1 — lo que SÍ debe cambiar el hash', () => {
  it.each<[string, PayloadEncuesta]>([
    ['folioLocal', { folioLocal: 'LX-9999' }],
    // Quién levantó la encuesta es contenido, no transporte: por eso hay que
    // capturarlo con el registro y no estamparlo al enviar.
    ['encuestador', { encuestador: 'Juan Pérez' }],
    // 420 s sigue dentro de la tolerancia contra el intervalo real (400 s), así
    // que el payload es válido: lo que cambia es el contenido, no su validez.
    ['duracionSegundos', { duracionSegundos: 420 }],
    ['idLocal', { idLocal: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }],
  ])('cambia si cambia %s', (_etiqueta, sobre) => {
    expect(hashV1De(encuestaV1CompletaValida(sobre))).not.toBe(
      hashV1De(encuestaV1CompletaValida()),
    );
  });

  it('cambia si cambia la ubicación, y ausente ≠ presente', () => {
    const base = encuestaV1CompletaValida();
    const otraUbicacion = encuestaV1CompletaValida({
      ubicacion: { ...(base.ubicacion as Record<string, unknown>), precisionMetros: 30 },
    });
    expect(hashV1De(otraUbicacion)).not.toBe(hashV1De(base));
    expect(hashV1De(sinClaves(base, 'ubicacion'))).not.toBe(hashV1De(base));
  });

  it('cambia entre completada y noElegible', () => {
    expect(hashV1De(encuestaV1NoElegibleValida())).not.toBe(hashV1De(encuestaV1CompletaValida()));
  });

  it('cambia con los metadatos del dispositivo y la versión de la app', () => {
    // Documentado en el plan como riesgo abierto: si la app estampa estos datos
    // al ENVIAR y no al capturar, un reintento tras actualizarse daría 409 y
    // habría que sacarlos del canónico.
    expect(hashV1De(encuestaV1CompletaValida({ versionAplicacion: '1.0.4' }))).not.toBe(
      hashV1De(encuestaV1CompletaValida()),
    );
    expect(
      hashV1De(
        encuestaV1CompletaValida({
          dispositivo: {
            ...(encuestaV1CompletaValida().dispositivo as Record<string, unknown>),
            modelo: 'Moto G84',
          },
        }),
      ),
    ).not.toBe(hashV1De(encuestaV1CompletaValida()));
  });
});

// Helpers v4: idénticos a los de v3, pero con schema y hash de la versión 4.
function hashV4De(payload: PayloadEncuesta): string {
  const r = encuestaV4Schema.safeParse(payload);
  if (!r.success) throw new Error('fixture v4 inválido: ' + JSON.stringify(r.error.issues));
  return hashEncuestaV4(r.data);
}

function canonicoV4(payload: PayloadEncuesta): string {
  return canonicalizarEncuestaV4(encuestaV4Schema.parse(payload));
}

function conRespuestasV4(cambios: Record<string, unknown>): PayloadEncuesta {
  const base = encuestaV4CompletaValida();
  return { ...base, respuestas: { ...(base.respuestas as Record<string, unknown>), ...cambios } };
}

// Estos hashes protegen la compatibilidad de los payloadHash PERSISTIDOS: son
// los sha256 reales que el algoritmo vigente produce para las tres fixtures
// deterministas. Si este test falla, tu cambio rompe la idempotencia de los
// reenvíos (los registros ya guardados dejarían de reconocer su reenvío y cada
// uno daría 409) y NO debe ajustarse la constante a la ligera: solo con una
// migración consciente de los hashes ya persistidos.
describe('golden hashes — compatibilidad con los payloadHash persistidos', () => {
  it('v1 completada conserva su hash', () => {
    expect(hashV1De(encuestaV1CompletaValida())).toBe(
      '7765fb8b8b0f34b59d1707264e39882736fdb6477aee7d9522dbaeec82df28db',
    );
  });

  it('v1 noElegible conserva su hash', () => {
    expect(hashV1De(encuestaV1NoElegibleValida())).toBe(
      '38c9636a21704cb6017bbe68dfb44e422cb26d397d355c6f1d27622c3083e376',
    );
  });

  it('v3 completada conserva su hash', () => {
    expect(hashDe(encuestaCompletaValida())).toBe(
      '684fb294d27cc70b6cba6c9c630bc88ac350117ca05ddd49f8a08703dc06d291',
    );
  });

  it('v4 completada con códigos normales preserva su hash (protege payloadHash v4 persistidos)', () => {
    // Este hash protege la estabilidad de los registros v4 que se persistan desde
    // este despliegue en adelante. El fixture v4 base trae códigos normales sin "otro".
    expect(hashV4De(encuestaV4CompletaValida())).toBe(
      '043af11ed4d5403f3f051a6fa77d7fa2841026e0ceba93a75ac85e5d1bf55723',
    );
  });

  it('v4 con "otro" + texto en ambos campos preserva su hash', () => {
    // Fixture alternativa: electoral "otro" + texto, partido "otro" + texto.
    // Protege cambios que rompan el hash cuando hay textos presentes.
    const v4conOtros = conRespuestasV4({
      preferenciaElectoral: 'otro',
      preferenciaElectoralOtro: 'Candidato independiente X',
      preferenciaPartido: 'otro',
      preferenciaPartidoOtro: 'Movimiento Popular Alternativo',
    });
    expect(hashV4De(v4conOtros)).toBe(
      '0a9fc6f464d16cf239fefbbf8da49404fe978f24b5f0877ccf319ddc5130690c',
    );
  });
});

describe('canonicalizarEncuestaV4 — estructura', () => {
  it('emite las claves en orden fijo (compatibilidad de hashes persistidos)', () => {
    const canónico = canonicoV4(encuestaV4CompletaValida());
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
    expect(objeto.v).toBe(3);
  });

  it('emite las respuestas en orden fijo por construcción', () => {
    const canónico = canonicoV4(encuestaV4CompletaValida());
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
      'preferenciaElectoralOtro',
      'preferenciaPartido',
      'preferenciaPartidoOtro',
      'aprobacionPorGobernante',
    ]);
  });

  it('trata preferenciaElectoralOtro y preferenciaPartidoOtro ausentes como null en el JSON canónico', () => {
    const sinTextos = conRespuestasV4({
      preferenciaElectoral: 'lalo_ximenez',
      preferenciaElectoralOtro: undefined,
      preferenciaPartido: 'morena',
      preferenciaPartidoOtro: undefined,
    });
    const canónico = canonicoV4(sinTextos);
    expect(canónico).toContain('"preferenciaElectoralOtro":null');
    expect(canónico).toContain('"preferenciaPartidoOtro":null');
  });

  it('preserva el texto cuando preferenciaElectoral es "otro"', () => {
    const conOtro = conRespuestasV4({
      preferenciaElectoral: 'otro',
      preferenciaElectoralOtro: 'Candidato X',
    });
    const canónico = canonicoV4(conOtro);
    expect(canónico).toContain('"preferenciaElectoral":"otro"');
    expect(canónico).toContain('"preferenciaElectoralOtro":"Candidato X"');
  });

  it('preserva el texto cuando preferenciaPartido es "otro"', () => {
    const conOtro = conRespuestasV4({
      preferenciaPartido: 'otro',
      preferenciaPartidoOtro: 'Movimiento Y',
    });
    const canónico = canonicoV4(conOtro);
    expect(canónico).toContain('"preferenciaPartido":"otro"');
    expect(canónico).toContain('"preferenciaPartidoOtro":"Movimiento Y"');
  });

  it('es estable ante reorden de aprobacionPorGobernante (conjunto, como v3)', () => {
    const reordenada = conRespuestasV4({
      aprobacionPorGobernante: [
        { gobernante: 'huerta', calificacion: 'regular' },
        { gobernante: 'jara', calificacion: 'buena' },
        { gobernante: 'sheinbaum', calificacion: 'muy_buena' },
      ],
    });
    const ordenOriginal = conRespuestasV4({
      aprobacionPorGobernante: [
        { gobernante: 'sheinbaum', calificacion: 'muy_buena' },
        { gobernante: 'jara', calificacion: 'buena' },
        { gobernante: 'huerta', calificacion: 'regular' },
      ],
    });
    expect(hashV4De(reordenada)).toBe(hashV4De(ordenOriginal));
  });

  it('ignora los campos de sincronización del teléfono', () => {
    const conSync = encuestaV4CompletaValida({
      estadoSincronizacion: 'reintentando',
      numeroIntentosSincronizacion: 7,
      fechaUltimoIntento: '2026-08-02T14:10:00.000Z',
      fechaSincronizacion: '2026-08-02T14:11:00.000Z',
      idRemoto: '9f1b3c2d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
    });
    expect(hashV4De(conSync)).toBe(hashV4De(encuestaV4CompletaValida()));
  });
});

# Encuestas Okrean v3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La ingesta `/api/v1/encuestas` y el portal de revisión pasan del cuestionario v1 al v3 (`versionCuestionario: 3`), que lo reemplaza por completo.

**Architecture:** Mismo esqueleto que v1: validator zod estricto (cara dispositivo) → hash canónico → servicio idempotente por `idLocal` → una fila por encuesta (escalares + JSONB). El portal REVISOR_QA (DTO, CSV en streaming, página Next) se actualiza a los campos v3. Migración sin TRUNCATE (gate `check-qa-migrations-safe.js`): UPDATE + recreación de enum + DROP/ADD COLUMN, columnas v3 nullable con obligatoriedad en el validador.

**Tech Stack:** Node 20 · Express 4 · TS 5 · zod 4 (subpath plano en ingesta, `zod/v4` en revisión) · Prisma 6.19 · PostgreSQL 16 · vitest · Next.js 16 / React 19 · TanStack Query/Table.

**Spec:** `docs/superpowers/specs/2026-08-05-encuestas-v3-design.md` (leerla antes de empezar).

## Global Constraints

- Rama de trabajo: `feat/encuestas-v3` a partir de `main` (crearla en el Task 1 si no existe; todos los tasks committean ahí).
- **WSL + node_modules de Windows:** todo `npm`/`npx` dentro de `api/` y `web/` se corre vía `cmd.exe /c "..."` desde la ruta del repo (los binarios nativos de vitest/esbuild/Tailwind son de Windows y fallan bajo node de WSL).
- Los tests de sprint5 usan Prisma en memoria y mocks: **no necesitan Postgres ni Redis** (`tests/setup.ts` pone env dummy).
- El módulo de encuestas **no importa nada de qa_externa** (debe poder borrarse entero); mantener esa regla.
- **No loguear contenido**: ni body, ni respuestas políticas, ni coordenadas, ni API keys (regla del router de ingesta).
- Contrato de respuesta de la ingesta INTACTO: 201/200 `{"idRemoto"}`, 409, 422 `{issues}`, 400 JSON malformado, 401, 429 con `Retry-After`, `GET /ping` 200 `{"ok":true}`, `GET /` 405.
- Comentarios: este repo escribe comentarios densos en español explicando el porqué; al reescribir archivos, conservar ese estilo y actualizar toda referencia a "v1" que quede obsoleta.
- Commits en español con prefijo `feat(encuestas):` / `test(encuestas):` / `docs(encuestas):`, terminados en:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SuiYy4d1GZng1NTa8DpgHJ
  ```
- Nota de secuencia: entre los Tasks 1 y 4 el `tsc --noEmit` global FALLA (canonical/servicios siguen importando símbolos v1 hasta que les toque su task). Cada task verifica su propia suite; el typecheck global cierra en verde en el Task 7.

---

### Task 1: Fixtures v3 + validator v3

**Files:**
- Modify: `api/tests/sprint5/fixtures.ts` (reescritura)
- Modify: `api/src/validators/encuestasIngestValidator.ts` (reescritura)
- Test: `api/tests/sprint5/encuestas-validator.test.ts` (reescritura)

**Interfaces:**
- Consumes: nada (task inicial).
- Produces: `encuestaV3Schema`, `type EncuestaV3`, catálogos `SEXOS_V3`, `RANGOS_EDAD_V3`, `SI_NO_V3`, `ROLES_LALO_V3`, `OPINIONES_LALO_V3`, `PREFERENCIAS_ELECTORALES_V3`, `PARTIDOS_V3`, `GOBERNANTES_V3`, `CALIFICACIONES_V3`, más `UUID_RE`, `FOLIO_LOCAL_RE`, `TOLERANCIA_DURACION_SEG` (sin cambios). Fixture `encuestaCompletaValida(overrides)` en v3; `encuestaNoElegibleValida` DESAPARECE.

- [ ] **Step 1: Crear la rama**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2" && git checkout -b feat/encuestas-v3
```

- [ ] **Step 2: Reescribir los fixtures a v3**

Sustituir en `api/tests/sprint5/fixtures.ts` las dos funciones de payload por una sola. Conservar `PayloadEncuesta`, `deepClone`, `sinClaves`, `DISPOSITIVO` y `SINCRONIZACION` tal cual; actualizar el comentario de cabecera (sigue siendo "el body tal como viaja por el cable"). La función nueva:

```ts
/**
 * Encuesta v3 completada: inicio 10:00:00Z, fin 10:06:40Z ⇒ 400 s, que es justo
 * lo que declara duracionSegundos (dentro de la tolerancia). Todos los campos de
 * respuestas son obligatorios en v3; no hay rama noElegible.
 */
export function encuestaCompletaValida(overrides: PayloadEncuesta = {}): PayloadEncuesta {
  return {
    idLocal: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    folioLocal: 'LX-1042',
    encuestador: 'María López',
    versionCuestionario: 3,
    estado: 'completada',
    fechaHoraInicio: '2026-08-01T10:00:00.000Z',
    fechaHoraFinalizacion: '2026-08-01T10:06:40.000Z',
    duracionSegundos: 400,
    respuestas: {
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
    },
    ubicacion: {
      disponible: true,
      latitud: 19.432608,
      longitud: -99.133209,
      precisionMetros: 12.5,
      fechaHoraCaptura: '2026-08-01T10:05:00.000Z',
      permiso: 'concedido',
      servicioActivo: true,
      esValida: true,
    },
    dispositivo: { ...DISPOSITIVO },
    versionAplicacion: '2.0.0',
    ...SINCRONIZACION,
    ...overrides,
  };
}
```

- [ ] **Step 3: Reescribir el test del validador (falla primero)**

Reescribir `api/tests/sprint5/encuestas-validator.test.ts` contra `encuestaV3Schema`/`EncuestaV3` (aún inexistentes). Cobertura mínima — usar este código como base, agrupado en `describe`s; el helper `conRespuestas` compone el sub-objeto entero (el merge de fixtures es superficial):

```ts
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
```

- [ ] **Step 4: Correr el test y verificar que FALLA**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-validator.test.ts"
```
Esperado: FAIL (`encuestaV3Schema` no existe).

- [ ] **Step 5: Reescribir el validador**

Reescribir `api/src/validators/encuestasIngestValidator.ts`. CONSERVAR sin cambios: la cabecera de comentario (actualizando "v1"→"v3" y la mención al dispatch de versión), `UUID_RE`, `FOLIO_LOCAL_RE`, `TOLERANCIA_DURACION_SEG`, `PRECISION_VALIDA_MAX_M`, `fechaIso`, `textoCorto`, `ubicacionDisponibleSchema`, `ubicacionNoDisponibleSchema`, `ubicacionV1Schema` (renombrarlo `ubicacionSchema`: el bloque de ubicación no cambió entre versiones) y el `superRefine` de fechas/duración. ELIMINAR los catálogos v1 (`PERSONAS_V1`, `NIVELES_CONOCIMIENTO_V1`, `MEDIOS_V1`, `PARTIDOS_V1`, `RANGOS_EDAD_V1`, `GENEROS_V1`), `conocimientoPorPersonaSchema`, `mediosConocimientoSchema`, `respuestasCompletadaSchema`, `respuestasNoElegibleSchema` y la unión discriminada por estado. Núcleo nuevo:

```ts
// Catálogos de la versión 3 del cuestionario. Viven en la app (TEXT validado
// aquí, no enums de Postgres) para que una v4 no exija ALTER TYPE.
export const SEXOS_V3 = ['hombre', 'mujer'] as const;
export const RANGOS_EDAD_V3 = ['18_30', '31_45', '46_mas'] as const;
export const SI_NO_V3 = ['si', 'no'] as const;
export const ROLES_LALO_V3 = [
  'politico_lider_social',
  'empresario',
  'funcionario_publico',
  'no_sabe_no_contesta',
] as const;
export const OPINIONES_LALO_V3 = [
  'muy_buena', 'buena', 'regular', 'mala', 'muy_mala', 'no_lo_conozco',
] as const;
export const PREFERENCIAS_ELECTORALES_V3 = [
  'lalo_ximenez', 'irineo_molina', 'fernando_huerta', 'paola_barrera', 'ana_gabriela_delgado',
] as const;
export const PARTIDOS_V3 = [
  'pri', 'morena', 'pan', 'panal_oaxaca', 'pt', 'prd_oaxaca', 'pvem', 'pto', 'mc',
] as const;
export const GOBERNANTES_V3 = ['sheinbaum', 'jara', 'huerta'] as const;
export const CALIFICACIONES_V3 = ['muy_buena', 'buena', 'regular', 'mala', 'muy_mala'] as const;

// Lista de nombres tecleados por el encuestador. Texto libre: se recorta y se
// acota, pero no hay catálogo ni control de duplicados (dos personas pueden
// llamarse igual).
const listaDeNombres = (campo: string, min: number) =>
  z
    .array(
      z
        .string({ error: `cada entrada de ${campo} debe ser texto` })
        .trim()
        .min(1, `las entradas de ${campo} no pueden ir vacías`)
        .max(80, `cada entrada de ${campo} no puede exceder 80 caracteres`),
      { error: `${campo} es obligatorio` },
    )
    // Con min 0 el .min() nunca dispara; el mensaje solo importa para políticos.
    .min(min, `${campo} debe traer al menos ${min} entrada`)
    .max(3, `${campo} no puede traer más de 3 entradas`);

// P10 — aprobación por gobernante: exactamente los 3 del catálogo, sin repetir.
const aprobacionPorGobernanteSchema = z
  .array(
    z.object({
      gobernante: z.enum(GOBERNANTES_V3, { error: 'gobernante fuera del catálogo de la versión 3' }),
      calificacion: z.enum(CALIFICACIONES_V3, { error: 'calificacion fuera del catálogo de la versión 3' }),
    }),
  )
  .length(3, 'aprobacionPorGobernante debe traer los 3 gobernantes del catálogo v3')
  .superRefine((filas, ctx) => {
    // El check corre aunque el parseo previo haya fallado: comprobar la forma
    // antes de recorrer (mismo criterio que el conocimientoPorPersona de v1).
    if (!Array.isArray(filas)) return;
    const distintos = new Set(filas.map((f) => f?.gobernante));
    if (distintos.size !== filas.length) {
      ctx.addIssue({ code: 'custom', message: 'aprobacionPorGobernante no puede repetir gobernantes' });
    }
  });

// Bloque de respuestas v3: TODOS los campos obligatorios, sin saltos de lógica.
// rolLalo y opinionLalo se contestan siempre (sus catálogos ya traen
// no_sabe_no_contesta / no_lo_conozco), así que NO hay coherencia cruzada con
// conoceLalo que validar.
const respuestasV3Schema = z.object({
  sexo: z.enum(SEXOS_V3, { error: 'sexo fuera del catálogo de la versión 3' }),
  rangoEdad: z.enum(RANGOS_EDAD_V3, { error: 'rangoEdad fuera del catálogo de la versión 3' }),
  empresariosConocidos: listaDeNombres('empresariosConocidos', 0),
  politicosConocidos: listaDeNombres('politicosConocidos', 1),
  conoceLalo: z.enum(SI_NO_V3, { error: 'conoceLalo debe ser si o no' }),
  rolLalo: z.enum(ROLES_LALO_V3, { error: 'rolLalo fuera del catálogo de la versión 3' }),
  opinionLalo: z.enum(OPINIONES_LALO_V3, { error: 'opinionLalo fuera del catálogo de la versión 3' }),
  preferenciaElectoral: z.enum(PREFERENCIAS_ELECTORALES_V3, {
    error: 'preferenciaElectoral fuera del catálogo de la versión 3',
  }),
  preferenciaPartido: z.enum(PARTIDOS_V3, {
    error: 'preferenciaPartido fuera del catálogo de la versión 3',
  }),
  aprobacionPorGobernante: aprobacionPorGobernanteSchema,
});

export const encuestaV3Schema = z
  .object({
    ...camposComunes, // igual que v1, pero con versionCuestionario: z.literal(3)
    estado: z.literal('completada'),
    respuestas: respuestasV3Schema,
  })
  .superRefine(/* mismo check de fechas/duración que hoy, sin cambios */);

export type EncuestaV3 = z.infer<typeof encuestaV3Schema>;
```

En `camposComunes` el único cambio es `versionCuestionario: z.literal(3)`. Nota: al no haber ya unión discriminada, el comentario de cabecera sobre zod 4 y `discriminatedUnion` se reescribe (el requisito de zod 4 se mantiene por el resto del código).

- [ ] **Step 6: Correr el test y verificar que PASA**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-validator.test.ts"
```
Esperado: PASS. (El resto de sprint5 y `tsc` global aún fallan: siguen en v1 hasta sus tasks.)

- [ ] **Step 7: Commit**

```bash
git add api/tests/sprint5/fixtures.ts api/tests/sprint5/encuestas-validator.test.ts api/src/validators/encuestasIngestValidator.ts
git commit -m "feat(encuestas): validator del cuestionario v3 (reemplaza al v1)"
```

---

### Task 2: Canonicalización y hash v3

**Files:**
- Modify: `api/src/lib/encuestasCanonical.ts` (reescritura)
- Test: `api/tests/sprint5/encuestas-canonical-hash.test.ts` (reescritura)

**Interfaces:**
- Consumes: `encuestaV3Schema`, `EncuestaV3`, `GOBERNANTES_V3` del Task 1.
- Produces: `canonicalizarEncuestaV3(d: EncuestaV3): string` y `hashEncuestaV3(d: EncuestaV3): string` (sha256 hex). `VERSION_CANONICA = 2`.

- [ ] **Step 1: Reescribir el test del hash (falla primero)**

Reescribir `api/tests/sprint5/encuestas-canonical-hash.test.ts`. Casos (todos parsean primero con `encuestaV3Schema` — el hash opera sobre lo validado):

```ts
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
```

- [ ] **Step 2: Correr y verificar FAIL**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-canonical-hash.test.ts"
```
Esperado: FAIL (`canonicalizarEncuestaV3` no existe).

- [ ] **Step 3: Reescribir el canónico**

Reescribir `api/src/lib/encuestasCanonical.ts`. Conservar la filosofía y el comentario de cabecera (actualizado a v3); `ubicacionCanonica` queda IGUAL. `VERSION_CANONICA = 2` con este comentario: la forma canónica v1 desapareció con el cuestionario, y aunque tras la migración no debería quedar ningún hash v1 en BDs que importen, subir `v` garantiza que un hash v3 jamás colisione con uno v1 residual. Núcleo:

```ts
import { createHash } from 'crypto';
import {
  GOBERNANTES_V3,
  type EncuestaV3,
} from '../validators/encuestasIngestValidator';

const VERSION_CANONICA = 2;

function respuestasCanonicas(d: EncuestaV3) {
  const r = d.respuestas;
  // El validador garantiza los 3 gobernantes sin repetir: el índice es total y
  // el .get() nunca queda en undefined. Se reordena al catálogo porque es un
  // conjunto de respuestas; las listas de texto libre NO se reordenan (el orden
  // en que el encuestador las dictó es parte del dato y el teléfono reenvía el
  // mismo JSON).
  const califPorGobernante = new Map(
    r.aprobacionPorGobernante.map((fila) => [fila.gobernante, fila.calificacion] as const),
  );
  return {
    sexo: r.sexo,
    rangoEdad: r.rangoEdad,
    empresariosConocidos: r.empresariosConocidos,
    politicosConocidos: r.politicosConocidos,
    conoceLalo: r.conoceLalo,
    rolLalo: r.rolLalo,
    opinionLalo: r.opinionLalo,
    preferenciaElectoral: r.preferenciaElectoral,
    preferenciaPartido: r.preferenciaPartido,
    aprobacionPorGobernante: GOBERNANTES_V3.map((gobernante) => ({
      gobernante,
      calificacion: califPorGobernante.get(gobernante)!,
    })),
  };
}

// ubicacionCanonica(u): idéntica a la actual, sin cambios.

export function canonicalizarEncuestaV3(d: EncuestaV3): string {
  return JSON.stringify({
    v: VERSION_CANONICA,
    idLocal: d.idLocal,
    folioLocal: d.folioLocal ?? null,
    encuestador: d.encuestador ?? null,
    versionCuestionario: d.versionCuestionario,
    estado: d.estado,
    fechaHoraInicio: d.fechaHoraInicio.toISOString(),
    fechaHoraFinalizacion: d.fechaHoraFinalizacion.toISOString(),
    duracionSegundos: d.duracionSegundos,
    respuestas: respuestasCanonicas(d),
    ubicacion: ubicacionCanonica(d.ubicacion),
    dispositivo: {
      plataforma: d.dispositivo.plataforma,
      modelo: d.dispositivo.modelo,
      versionSistema: d.dispositivo.versionSistema,
    },
    versionAplicacion: d.versionAplicacion,
  });
}

export function hashEncuestaV3(d: EncuestaV3): string {
  return createHash('sha256').update(canonicalizarEncuestaV3(d), 'utf8').digest('hex');
}
```

Nota: la clave `elegibilidad` desaparece del objeto canónico (ya no existe en el contrato).

- [ ] **Step 4: Correr y verificar PASS**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-canonical-hash.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/encuestasCanonical.ts api/tests/sprint5/encuestas-canonical-hash.test.ts
git commit -m "feat(encuestas): canonicalización y hash del cuestionario v3"
```

---

### Task 3: Migración + schema.prisma

**Files:**
- Create: `api/prisma/migrations/20260805120000_encuestas_v3/migration.sql`
- Modify: `api/prisma/schema.prisma` (modelo `Encuesta`, enums)

**Interfaces:**
- Consumes: nada del código TS.
- Produces: columnas Prisma `sexo`, `rangoEdad`, `empresariosConocidos`, `politicosConocidos`, `conoceLalo`, `rolLalo`, `opinionLalo`, `preferenciaElectoral`, `preferenciaPartido`, `aprobacionPorGobernante` (todas opcionales, `String?`/`Json?`); `enum EncuestaEstado { completada }`; el modelo YA NO tiene `elegibilidad`, `credencialVigente`, `genero`, `partidoPreferido`, `conocimientoPorPersona`, `mediosConocimiento`, `mayorPersonalidad`, `candidatoPreferido` ni el enum `EncuestaElegibilidad`.

- [ ] **Step 1: Escribir la migración**

Crear `api/prisma/migrations/20260805120000_encuestas_v3/migration.sql`:

```sql
-- Cuestionario v3 de "Encuestas Okrean": reemplaza por completo al v1.
-- SIN TRUNCATE/DELETE/DROP TABLE (gate scripts/check-qa-migrations-safe.js):
-- las capturas de campo se reestructuran con ALTER/UPDATE. Una fila v1
-- residual (solo en BDs de dev; producción no tiene datos v1) sobrevive con
-- version_cuestionario = 1 y las columnas v3 en NULL.

-- estado: el enum queda solo con 'completada' (la rama noElegible desaparece
-- del contrato). Receta estándar de Postgres para reducir un enum.
UPDATE "encuestas" SET "estado" = 'completada' WHERE "estado" <> 'completada';
CREATE TYPE "EncuestaEstado_new" AS ENUM ('completada');
ALTER TABLE "encuestas"
  ALTER COLUMN "estado" TYPE "EncuestaEstado_new"
  USING ('completada'::"EncuestaEstado_new");
DROP TYPE "EncuestaEstado";
ALTER TYPE "EncuestaEstado_new" RENAME TO "EncuestaEstado";

-- Fuera la elegibilidad del registro y las respuestas v1.
ALTER TABLE "encuestas"
  DROP COLUMN "elegibilidad",
  DROP COLUMN "credencial_vigente",
  DROP COLUMN "rango_edad",
  DROP COLUMN "genero",
  DROP COLUMN "partido_preferido",
  DROP COLUMN "conocimiento_por_persona",
  DROP COLUMN "medios_conocimiento",
  DROP COLUMN "mayor_personalidad",
  DROP COLUMN "candidato_preferido";
DROP TYPE "EncuestaElegibilidad";

-- Respuestas v3. Catálogos como TEXT validado en la app, no enums de Postgres
-- (una v4 no debe exigir ALTER TYPE). NULLABLES: la obligatoriedad la impone
-- el validador y el servicio siempre escribe valor; NULL es la representación
-- natural de una fila v1 residual.
ALTER TABLE "encuestas"
  ADD COLUMN "sexo" TEXT,
  ADD COLUMN "rango_edad" TEXT,
  ADD COLUMN "empresarios_conocidos" JSONB,
  ADD COLUMN "politicos_conocidos" JSONB,
  ADD COLUMN "conoce_lalo" TEXT,
  ADD COLUMN "rol_lalo" TEXT,
  ADD COLUMN "opinion_lalo" TEXT,
  ADD COLUMN "preferencia_electoral" TEXT,
  ADD COLUMN "preferencia_partido" TEXT,
  ADD COLUMN "aprobacion_por_gobernante" JSONB;
```

- [ ] **Step 2: Actualizar schema.prisma**

En `api/prisma/schema.prisma`:
1. `enum EncuestaEstado` queda solo con `completada`; ELIMINAR `enum EncuestaElegibilidad` completo.
2. En `model Encuesta`, eliminar las líneas `elegibilidad`, `credencialVigente`, `rangoEdad`, `genero`, `partidoPreferido`, `conocimientoPorPersona`, `mediosConocimiento`, `mayorPersonalidad`, `candidatoPreferido` y sustituirlas por:

```prisma
  /// Respuestas v3. NULLABLES en BD aunque el contrato las exige todas: la
  /// obligatoriedad la sella el validador y el servicio siempre escribe valor.
  /// NULL = fila v1 residual de una BD de dev (version_cuestionario = 1).
  sexo                        String?
  rangoEdad                   String?              @map("rango_edad")
  empresariosConocidos        Json?                @map("empresarios_conocidos")
  politicosConocidos          Json?                @map("politicos_conocidos")
  conoceLalo                  String?              @map("conoce_lalo")
  rolLalo                     String?              @map("rol_lalo")
  opinionLalo                 String?              @map("opinion_lalo")
  preferenciaElectoral        String?              @map("preferencia_electoral")
  preferenciaPartido          String?              @map("preferencia_partido")
  aprobacionPorGobernante     Json?                @map("aprobacion_por_gobernante")
```

3. Actualizar el comentario del modelo (habla de P5/P6 y las 7 personas): ahora los JSONB son las dos listas de nombres y la aprobación por gobernante; la razón (un solo INSERT atómico) no cambia.

- [ ] **Step 3: Validar y regenerar el cliente**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx prisma validate" && cmd.exe /c "npx prisma generate"
```
Esperado: ambos OK.

- [ ] **Step 4: Correr los guards de migraciones**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npm run test:migrations"
```
Esperado: PASS (sin TRUNCATE/DELETE/DROP TABLE sobre `encuestas*`).

- [ ] **Step 5: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/migrations/20260805120000_encuestas_v3/
git commit -m "feat(encuestas): migración y schema del cuestionario v3"
```

---

### Task 4: Servicio de ingesta + router

**Files:**
- Modify: `api/src/services/encuestasIngestService.ts`
- Modify: `api/src/routes/encuestasIngestRouter.ts`
- Test: `api/tests/sprint5/encuestas-ingest-service.test.ts`, `api/tests/sprint5/encuestas-ingest-http.test.ts` (adaptación)
- Verify: `api/tests/sprint5/encuestas-device-auth.test.ts`, `api/tests/sprint5/errorhandler-bodyparser.test.ts` (sin cambios esperados; correrlos)

**Interfaces:**
- Consumes: `EncuestaV3`, `GOBERNANTES_V3`, `encuestaV3Schema` (Task 1); `hashEncuestaV3` (Task 2); columnas Prisma del Task 3.
- Produces: `ingestEncuesta(input: IngestEncuestaInput): Promise<IngestEncuestaResult>` con la misma firma pública (`parsed` pasa a ser `EncuestaV3`). Router con `VERSION_SOPORTADA = 3`.

- [ ] **Step 1: Adaptar los tests del servicio (fallan primero)**

En `api/tests/sprint5/encuestas-ingest-service.test.ts` (usa Prisma en memoria con inyección `ingestEncuestaWithDeps`): los flujos de idempotencia (201/200/409/carrera P2002) quedan IGUAL, solo cambian los fixtures (ya en v3 desde el Task 1) y las aserciones de mapeo de fila. Sustituir las aserciones sobre `credencialVigente`/`rangoEdad`/`genero`/`partidoPreferido`/`conocimientoPorPersona`/`mediosConocimiento`/`mayorPersonalidad`/`candidatoPreferido`/`elegibilidad` por:

```ts
// La fila aplana las respuestas v3 y normaliza la aprobación al orden del
// catálogo aunque el teléfono la haya mandado en otro orden.
expect(filaCreada).toMatchObject({
  estado: 'completada',
  versionCuestionario: 3,
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
});
expect(filaCreada).not.toHaveProperty('elegibilidad');
```

Añadir un caso que ingiere el payload con `aprobacionPorGobernante` en orden `[huerta, sheinbaum, jara]` y verifica que la fila la guarda en el orden del catálogo. Los casos v1 que usaban `encuestaNoElegibleValida` se ELIMINAN.

- [ ] **Step 2: Adaptar los tests HTTP (fallan primero)**

En `api/tests/sprint5/encuestas-ingest-http.test.ts` (monta router+servicio reales sobre Prisma en memoria): el contrato 201/200/409/422/400/413/405 queda IGUAL. Cambios:
- El caso `UNSUPPORTED_VERSION` ahora prueba `versionCuestionario: 1` **y** `2` → 422 `{code:'UNSUPPORTED_VERSION', details:{versionCuestionario:1|2}}` (la app v1 vieja debe leer "actualiza el servidor/app", no "registro corrupto").
- El caso 409 se construye con el mismo `idLocal` y `respuestas` distintas, p. ej. `conRespuestas({ opinionLalo: 'mala' })`.
- Los casos sobre la rama `noElegible` se ELIMINAN.
- El caso 422 de validación usa un campo v3 (p. ej. `sexo: 'otro'`) y verifica `issues[].field === 'respuestas.sexo'`.

- [ ] **Step 3: Correr y verificar FAIL**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-ingest-service.test.ts tests/sprint5/encuestas-ingest-http.test.ts"
```
Esperado: FAIL (servicio y router siguen en v1).

- [ ] **Step 4: Actualizar el servicio**

En `api/src/services/encuestasIngestService.ts`:
- Imports: `GOBERNANTES_V3, type EncuestaV3` en lugar de `MEDIOS_V1, PERSONAS_V1, type EncuestaV1`.
- `IngestEncuestaInput.parsed: EncuestaV3`.
- `RespuestasRow` pasa a:

```ts
type RespuestasRow = Pick<
  Prisma.EncuestaUncheckedCreateInput,
  | 'sexo'
  | 'rangoEdad'
  | 'empresariosConocidos'
  | 'politicosConocidos'
  | 'conoceLalo'
  | 'rolLalo'
  | 'opinionLalo'
  | 'preferenciaElectoral'
  | 'preferenciaPartido'
  | 'aprobacionPorGobernante'
>;

function respuestasRow(d: EncuestaV3): RespuestasRow {
  const r = d.respuestas;
  // Se guarda la MISMA normalización que entra al hash (encuestasCanonical.ts):
  // la aprobación reordenada al catálogo de GOBERNANTES_V3; las listas de texto
  // libre tal como llegaron (su orden es dato). El validador garantiza los 3
  // gobernantes sin repetir, así que el .get() nunca queda en undefined.
  const califPorGobernante = new Map(
    r.aprobacionPorGobernante.map((fila) => [fila.gobernante, fila.calificacion] as const),
  );
  return {
    sexo: r.sexo,
    rangoEdad: r.rangoEdad,
    empresariosConocidos: r.empresariosConocidos,
    politicosConocidos: r.politicosConocidos,
    conoceLalo: r.conoceLalo,
    rolLalo: r.rolLalo,
    opinionLalo: r.opinionLalo,
    preferenciaElectoral: r.preferenciaElectoral,
    preferenciaPartido: r.preferenciaPartido,
    aprobacionPorGobernante: GOBERNANTES_V3.map((gobernante) => ({
      gobernante,
      calificacion: califPorGobernante.get(gobernante)!,
    })),
  };
}
```

- `UbicacionRow`, `ubicacionRow` y todo el flujo idempotente: SIN CAMBIOS.
- En `mapEncuestaToRow`: eliminar la línea `elegibilidad: d.elegibilidad,`; el resto igual.
- Cabecera del archivo: sigue siendo válida; actualizar "encuesta v1"→"v3" y la mención "P5/P6 viven en columnas JSONB" → las listas y la aprobación.

- [ ] **Step 5: Actualizar el router**

En `api/src/routes/encuestasIngestRouter.ts`, tres líneas:

```ts
const VERSION_SOPORTADA = 3;
// imports:
import { encuestaV3Schema } from '../validators/encuestasIngestValidator';
import { hashEncuestaV3 } from '../lib/encuestasCanonical';
```

y en el handler `encuestaV1Schema.safeParse` → `encuestaV3Schema.safeParse`, `hashEncuestaV1(...)` → `hashEncuestaV3(...)`. El comentario del dispatch de versión ("un cuestionario v2 legítimo…") se actualiza: ahora habla de versiones ≠ 3 (una app vieja en v1 incluida).

- [ ] **Step 6: Correr las 4 suites y verificar PASS**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-ingest-service.test.ts tests/sprint5/encuestas-ingest-http.test.ts tests/sprint5/encuestas-device-auth.test.ts tests/sprint5/errorhandler-bodyparser.test.ts"
```
Esperado: PASS las cuatro (device-auth y errorhandler no deberían requerir cambios; si fallan por el fixture, adaptar solo el fixture usado).

- [ ] **Step 7: Commit**

```bash
git add api/src/services/encuestasIngestService.ts api/src/routes/encuestasIngestRouter.ts api/tests/sprint5/encuestas-ingest-service.test.ts api/tests/sprint5/encuestas-ingest-http.test.ts
git commit -m "feat(encuestas): ingesta v3 (servicio idempotente + router)"
```

---

### Task 5: Portal de revisión (validator + servicio + router)

**Files:**
- Modify: `api/src/validators/encuestasRevisionValidator.ts`
- Modify: `api/src/services/encuestasRevisionService.ts`
- Modify: `api/src/routes/encuestasRevisionRouter.ts`
- Test: `api/tests/sprint5/encuestas-revision-lectura.test.ts`, `api/tests/sprint5/encuestas-export-http.test.ts` (adaptación)

**Interfaces:**
- Consumes: `GOBERNANTES_V3` (Task 1); columnas Prisma del Task 3.
- Produces: `EncuestaDto` v3 (abajo), `EncuestaExportRow` v3, `ENCUESTAS_CSV_HEADERS` (36 columnas), `toCsvRow`, `iterateForExport`, `buildWhere` — sin parámetro `estado` en `EncuestasListQuery`. Nombre de archivo CSV: `encuestas-<dateFrom>_<dateTo>.csv`.

- [ ] **Step 1: Adaptar los tests de revisión (fallan primero)**

En `encuestas-revision-lectura.test.ts` y `encuestas-export-http.test.ts` (mocks de prisma en memoria): mantener la estructura, cambiar:
- Filas semilla del mock a v3 (campos de `respuestasRow` del Task 4; incluir una fila con `aprobacionPorGobernante` en JSONB y las dos listas).
- Aserciones del DTO a la forma nueva:

```ts
expect(dto).toEqual({
  id: expect.any(Number),
  idRemoto: expect.any(String),
  folioLocal: 'LX-1042',
  encuestador: 'María López',
  versionCuestionario: 3,
  preferenciaElectoral: 'lalo_ximenez',
  preferenciaPartido: 'morena',
  conoceLalo: 'si',
  duracionSegundos: 400,
  fechaHoraFinalizacion: expect.any(Date),
  recibidoEn: expect.any(Date),
  ubicacionDisponible: true,
  dispositivo: { id: expect.any(Number), identificador: expect.any(String) },
});
expect(dto).not.toHaveProperty('estado');
expect(dto).not.toHaveProperty('payloadRaw');
```

- Filtro `estado`: los casos que filtraban por estado se ELIMINAN; añadir uno que verifica que `?estado=completada` en la query NO produce error (zod estripa las claves no declaradas) y no altera el `where`.
- CSV: cabeceras nuevas (constante de abajo), pivoteo de las 3 columnas de aprobación, listas unidas con `;`, y el caso de neutralización de fórmulas usando una entrada de lista `=HYPERLINK(...)` en `politicosConocidos`.
- Nombre de archivo: `encuestas-2026-08-01_2026-08-05.csv` (sin el segmento de estado) en `Content-Disposition` de GET y HEAD.
- Los casos de contrapresión/error-a-media-descarga/CSV vacío: solo cambian datos semilla.

- [ ] **Step 2: Correr y verificar FAIL**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-revision-lectura.test.ts tests/sprint5/encuestas-export-http.test.ts"
```

- [ ] **Step 3: Actualizar el validator de revisión**

En `api/src/validators/encuestasRevisionValidator.ts`: eliminar `estadoFiltro` y la clave `estado` de `encuestasQuerySchema` y `encuestasExportQuerySchema` (comentar por qué: el enum quedó con un solo valor en v3; un filtro de una sola opción es UI muerta). Todo lo demás igual.

- [ ] **Step 4: Actualizar el servicio de revisión**

En `api/src/services/encuestasRevisionService.ts`:
- Import: `GOBERNANTES_V3` en lugar de `PERSONAS_V1, MEDIOS_V1`.
- `EncuestasListQuery`: eliminar `estado?`.
- `EncuestaDto`: eliminar `estado`, `elegibilidad`, `partidoPreferido`, `candidatoPreferido`; añadir `preferenciaElectoral: string | null`, `preferenciaPartido: string | null`, `conoceLalo: string | null` (nullables: la columna lo es; una fila v1 residual sale con null y el front pinta '—').
- `encuestaListSelect`: mismo cambio de campos.
- `toDto`: mismo cambio de campos.
- `EncuestaExportRow`: conservar `estado: EncuestaEstado` y `versionCuestionario`; sustituir el bloque v1 por:

```ts
  sexo: string | null;
  rangoEdad: string | null;
  empresariosConocidos: unknown;
  politicosConocidos: unknown;
  conoceLalo: string | null;
  rolLalo: string | null;
  opinionLalo: string | null;
  preferenciaElectoral: string | null;
  preferenciaPartido: string | null;
  aprobacionPorGobernante: unknown;
```

  (los tres `unknown` con el mismo comentario que hoy: la BD no garantiza la forma; el pivoteo la comprueba en runtime). Eliminar `elegibilidad` y `credencialVigente`.
- `encuestaExportSelect`: reflejar exactamente esos campos (sigue sin `payloadRaw`/`payloadHash`).
- `buildWhere`: eliminar la rama `if (params.estado)`.
- Cabeceras:

```ts
export const ENCUESTAS_CSV_HEADERS = [
  'ID remoto', 'ID local', 'Folio', 'Encuestador',
  'Recibido (UTC)', 'Inicio (UTC)', 'Finalización (UTC)', 'Duración (s)',
  'Estado', 'Versión cuestionario',
  'Sexo', 'Rango edad', 'Empresarios conocidos', 'Políticos conocidos',
  'Conoce Lalo', 'Rol Lalo', 'Opinión Lalo',
  'Preferencia electoral', 'Preferencia partido',
  'Aprobación sheinbaum', 'Aprobación jara', 'Aprobación huerta',
  'Ubicación disponible', 'Latitud', 'Longitud', 'Precisión (m)',
  'Ubicación válida', 'Captura GPS (UTC)', 'Permiso ubicación',
  'Servicio ubicación activo', 'Motivo no disponible',
  'Plataforma', 'Modelo', 'Versión sistema', 'Versión app', 'Dispositivo',
] as const;
```

- Sustituir `nivelesPorPersona`/`celdasDeMedios` por:

```ts
/**
 * Pivotea el JSONB de aprobación ([{gobernante, calificacion}]) a un mapa
 * gobernante→calificación. Ignora lo que no tenga la forma esperada en vez de
 * reventar: el CSV de 50 000 filas no puede caerse por una fila anómala (una
 * v1 residual trae NULL aquí).
 */
function calificacionesPorGobernante(valor: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  if (!Array.isArray(valor)) return mapa;
  for (const fila of valor) {
    if (!fila || typeof fila !== 'object') continue;
    const { gobernante, calificacion } = fila as { gobernante?: unknown; calificacion?: unknown };
    if (typeof gobernante === 'string' && typeof calificacion === 'string') {
      mapa.set(gobernante, calificacion);
    }
  }
  return mapa;
}

/**
 * Lista de nombres (texto libre) unida con ';'. Se emite en el orden guardado
 * (que es el orden en que el encuestador la dictó); cada entrada ya pasó por
 * el tope de 80 chars del validador y la celda completa pasa por csvEscape.
 */
function celdaDeLista(valor: unknown): string {
  if (!Array.isArray(valor)) return '';
  return valor.filter((v): v is string => typeof v === 'string').join(';');
}
```

- `toCsvRow` (mismo esqueleto, celdas nuevas en el orden de las cabeceras):

```ts
export function toCsvRow(encuesta: EncuestaExportRow): string {
  const calificaciones = calificacionesPorGobernante(encuesta.aprobacionPorGobernante);
  return (
    [
      encuesta.idRemoto,
      encuesta.idLocal,
      encuesta.folioLocal,
      encuesta.encuestador,
      encuesta.recibidoEn.toISOString(),
      encuesta.fechaHoraInicio.toISOString(),
      encuesta.fechaHoraFinalizacion.toISOString(),
      encuesta.duracionSegundos,
      encuesta.estado,
      encuesta.versionCuestionario,
      encuesta.sexo,
      encuesta.rangoEdad,
      celdaDeLista(encuesta.empresariosConocidos),
      celdaDeLista(encuesta.politicosConocidos),
      encuesta.conoceLalo,
      encuesta.rolLalo,
      encuesta.opinionLalo,
      encuesta.preferenciaElectoral,
      encuesta.preferenciaPartido,
      ...GOBERNANTES_V3.map((g) => calificaciones.get(g) ?? ''),
      siNo(encuesta.ubicacionDisponible),
      encuesta.ubicacionLat,
      encuesta.ubicacionLng,
      encuesta.ubicacionPrecisionM,
      siNo(encuesta.ubicacionEsValida),
      encuesta.ubicacionCapturadaAt ? encuesta.ubicacionCapturadaAt.toISOString() : '',
      encuesta.ubicacionPermiso,
      siNo(encuesta.ubicacionServicioActivo),
      encuesta.ubicacionMotivoNoDisponible,
      encuesta.dispositivoPlataforma,
      encuesta.dispositivoModelo,
      encuesta.dispositivoVersionSistema,
      encuesta.versionAplicacion,
      encuesta.dispositivo.identificador,
    ]
      .map(csvEscape)
      .join(',') + '\r\n'
  );
}
```

- `csvEscape`, `siNo`, `list`, `iterateForExport`: SIN CAMBIOS (solo quitar `estado` de las llamadas si el tipo lo exige).

- [ ] **Step 5: Actualizar el router de revisión**

En `api/src/routes/encuestasRevisionRouter.ts`: quitar `estado` del objeto pasado a `service.list`/`service.iterateForExport` y simplificar:

```ts
function csvFilename(q: EncuestasExportQueryInput): string {
  return `encuestas-${q.dateFrom}_${q.dateTo}.csv`;
}
```

El comentario del listado sobre `Cache-Control` menciona "partido y candidato preferidos": actualizarlo a "preferencias electorales del encuestado". Todo lo demás (escritor con contrapresión, cabeceras diferidas, BOM, HEAD) SIN CAMBIOS.

- [ ] **Step 6: Correr y verificar PASS**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-revision-lectura.test.ts tests/sprint5/encuestas-export-http.test.ts"
```

- [ ] **Step 7: Commit**

```bash
git add api/src/validators/encuestasRevisionValidator.ts api/src/services/encuestasRevisionService.ts api/src/routes/encuestasRevisionRouter.ts api/tests/sprint5/encuestas-revision-lectura.test.ts api/tests/sprint5/encuestas-export-http.test.ts
git commit -m "feat(encuestas): portal de revisión y CSV en v3 (sin filtro de estado)"
```

---

### Task 6: Web (hook + página de revisión)

**Files:**
- Modify: `web/src/hooks/useEncuestas.ts`
- Modify: `web/src/app/revision/encuestas/page.tsx`

**Interfaces:**
- Consumes: `EncuestaDto` v3 del Task 5 (mismos nombres de campo en JSON).
- Produces: tipo `Encuesta` v3 del cliente; `useEncuestas({page, limit, dateFrom, dateTo})`; `descargarEncuestasCsv({dateFrom, dateTo})`.

> ⚠️ `web/AGENTS.md`: este Next.js 16 tiene breaking changes — leer la guía relevante en `web/node_modules/next/dist/docs/` antes de escribir código de Next. (Este task solo toca un hook y un client component, pero la regla aplica.)

- [ ] **Step 1: Actualizar el hook**

En `web/src/hooks/useEncuestas.ts`:
- Eliminar `EncuestaEstado` y `EncuestaElegibilidad`.
- Interface `Encuesta`: eliminar `estado`, `elegibilidad`, `partidoPreferido`, `candidatoPreferido`; añadir (nullables — una fila v1 residual del servidor de dev llega en null):

```ts
  preferenciaElectoral: string | null;
  preferenciaPartido: string | null;
  conoceLalo: string | null;
```

- `EncuestaQuery` y `EncuestasCsvParams`: eliminar `estado`; en `buildParams` quitar la línea de `estado`; en `descargarEncuestasCsv` el fallback del nombre pasa a `` `encuestas-${params.dateFrom}_${params.dateTo}.csv` ``.

- [ ] **Step 2: Actualizar la página**

En `web/src/app/revision/encuestas/page.tsx`:
- Eliminar `ESTADO_OPTIONS`, el estado local `estado`, el `<select>` de estado y sus usos (`limpiarFiltros`, `hasFilters`, `useEncuestas`, `handleDescargarCsv`).
- Quitar el import de `Badge` (solo lo usaba la columna Estado).
- En `columns`: eliminar las columnas `estado`, `elegibilidad`, `partidoPreferido`, `candidatoPreferido`; añadir en su lugar:

```tsx
  {
    accessorKey: 'preferenciaElectoral',
    header: 'Preferencia electoral',
    cell: ({ row }) => row.original.preferenciaElectoral ?? '—',
  },
  {
    accessorKey: 'preferenciaPartido',
    header: 'Preferencia partido',
    cell: ({ row }) => row.original.preferenciaPartido ?? '—',
  },
  {
    accessorKey: 'conoceLalo',
    header: 'Conoce a Lalo',
    // 'si'/'no' del catálogo v3; null = fila v1 residual sin el dato.
    cell: ({ row }) => {
      const v = row.original.conoceLalo;
      if (v === null || v === undefined) return '—';
      return v === 'si' ? 'Sí' : 'No';
    },
  },
```

- `emptyDescription` del `DataTable` menciona "Cambia el estado o el rango de fechas": reescribir a "Cambia el rango de fechas e intenta nuevamente.".

- [ ] **Step 3: Verificar typecheck, lint y build de web**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/web" && cmd.exe /c "npx tsc --noEmit" && cmd.exe /c "npm run lint" && cmd.exe /c "npm run build"
```
Esperado: los tres OK. (El build usa env dummy como en CI si hace falta: `NEXT_PUBLIC_TURNSTILE_ENABLED=false`.)

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useEncuestas.ts web/src/app/revision/encuestas/page.tsx
git commit -m "feat(encuestas): página de revisión en v3 (preferencias en vez de partido/candidato)"
```

---

### Task 7: Docs + verificación integral

**Files:**
- Modify: `docs/encuestas-okrean.md`
- Modify: `docs/encuestas-okrean-openapi.yaml`

**Interfaces:**
- Consumes: contrato v3 completo (spec §2) y catálogos del Task 1.
- Produces: documentación pública del contrato v3; rama verde con el set del CI.

- [ ] **Step 1: Actualizar `docs/encuestas-okrean.md`**

Leer el documento completo primero. Cambios (manteniendo estructura y tono):
- Toda mención de `versionCuestionario: 1` pasa a `3`; nueva nota al inicio: *el servidor solo acepta v3; un registro v1/v2 recibe 422 `UNSUPPORTED_VERSION` y la app debe actualizarse*.
- Sustituir el bloque del esquema de `respuestas` v1 y sus catálogos por el contrato v3 (copiar el bloque JSONC de la spec §2 con las reglas: todos obligatorios, empresarios 0–3, políticos 1–3, entradas 1–80 chars, aprobación con exactamente los 3 gobernantes sin repetir, sin saltos de lógica).
- Eliminar la rama `noElegible`/`elegibilidad` de la narrativa y los ejemplos; `estado` siempre `"completada"`.
- Actualizar el ejemplo de payload completo al fixture del Task 1 (mismo contenido).
- Sección del CSV: nueva lista de columnas (las 36 de `ENCUESTAS_CSV_HEADERS`) y el nombre de archivo `encuestas-<dateFrom>_<dateTo>.csv`; el filtro de estado desaparece del portal.
- Los comandos de alta/revocación de dispositivos (`--no-deps`) NO cambian.

- [ ] **Step 2: Actualizar `docs/encuestas-okrean-openapi.yaml`**

- `components.schemas`: reemplazar el schema de `respuestas` v1 por el v3 (enums de catálogo, `empresariosConocidos` array 0–3 / `politicosConocidos` array 1–3 de strings 1–80, `aprobacionPorGobernante` array `minItems: 3, maxItems: 3` de `{gobernante: enum, calificacion: enum}`), quitar `elegibilidad` del registro, `estado: enum [completada]`, `versionCuestionario: enum [3]` (o `const: 3`).
- Ejemplos de request/response actualizados al fixture v3.
- La descripción del 422 documenta ambos códigos: `VALIDATION_ERROR` y `UNSUPPORTED_VERSION` (este último para `versionCuestionario ≠ 3`).
- Validar sintaxis: `python3 -c "import yaml; yaml.safe_load(open('docs/encuestas-okrean-openapi.yaml'))"` (desde la raíz del repo, con el python de WSL).

- [ ] **Step 3: Barrido de referencias v1 huérfanas**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2" && grep -rn "PERSONAS_V1\|MEDIOS_V1\|PARTIDOS_V1\|GENEROS_V1\|NIVELES_CONOCIMIENTO_V1\|RANGOS_EDAD_V1\|EncuestaElegibilidad\|credencialVigente\|mayorPersonalidad\|candidatoPreferido\|encuestaV1Schema\|hashEncuestaV1\|EncuestaV1\b" api/src api/tests web/src docs/encuestas-okrean.md docs/encuestas-okrean-openapi.yaml
```
Esperado: sin resultados (o solo menciones históricas deliberadas en comentarios). Resolver cualquier hallazgo.

- [ ] **Step 4: Verificación integral (set del CI local)**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5"
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx prisma validate" && cmd.exe /c "npm run test:migrations" && cmd.exe /c "npm run test:config-refs"
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx tsc --noEmit" && cmd.exe /c "npm run build"
```
Esperado: TODO verde (web ya quedó verde en el Task 6). Si `test:config-refs` u otra suite ajena falla por una referencia a encuestas, arreglarla aquí.

- [ ] **Step 5: Commit final y PR**

```bash
git add docs/encuestas-okrean.md docs/encuestas-okrean-openapi.yaml
git commit -m "docs(encuestas): contrato v3 en la guía y el OpenAPI"
git push -u origin feat/encuestas-v3
```

Abrir PR contra `main` titulado `feat(encuestas): cuestionario v3 (reemplaza al v1)`, cuerpo con: resumen del contrato v3, la decisión de migración sin TRUNCATE (gate de migraciones), la eliminación del filtro de estado, y el enlace a la spec. Cierre del cuerpo:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SuiYy4d1GZng1NTa8DpgHJ
```

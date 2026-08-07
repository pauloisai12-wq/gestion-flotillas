# Encuestas v1 restaurada — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/v1/encuestas` vuelve a aceptar el cuestionario v1 (8 preguntas del PDF "ENCUESTAS LX") junto al v3, con visibilidad completa en revisión y CSV.

**Architecture:** Resurrección del código v1 desde el historial de git (commit `fd8294a`, el último con v1 completo) integrada JUNTO al v3 vigente: el router despacha por `versionCuestionario` (1|3), el validador/servicio/hash tienen rama por versión, una migración aditiva re-crea las columnas v1 que borró `20260805120000_encuestas_v3`, y el CSV exporta la unión de columnas. Spec: `docs/superpowers/specs/2026-08-06-encuestas-v1-restaurada-design.md`.

**Tech Stack:** Node 20 · Express 4 · TS 5 · Prisma 6.19 · zod 4 (subpath plano) · vitest (`npm run test:sprint5`) · Next.js 16 / React 19.

## Global Constraints

- **Rama de trabajo:** `feat/encuestas-v1-restaurada` (ya creada; el spec ya está commiteado ahí).
- **Fuente del código v1:** commit `fd8294a` (`git show fd8294a:<ruta>`). NO reescribir de memoria lo que ese commit ya tiene: restaurar y adaptar.
- **Los binarios de `node_modules` son de Windows** (WSL): TODO comando npm/npx/vitest/tsc/prisma se corre vía `cmd.exe /c "..."` desde el directorio del app, con salida a un log que luego se lee. Patrón:
  `cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5 > vitest-sprint5.log 2>&1"; tail -60 vitest-sprint5.log`
  Los `*.log` NO se commitean (no hacer `git add -A`; añadir archivos por nombre).
- **Sin TRUNCATE/DELETE/DROP TABLE en migraciones** (gate `scripts/check-qa-migrations-safe.js`).
- **No tocar** los catálogos v3, `qa_externa`, ni relajar validaciones existentes.
- **El contrato v1 es EXACTO al histórico**: mismos nombres de campos, catálogos y mensajes; la app móvil ya lo habla.
- Comentarios en español, mismo estilo/densidad que los archivos tocados.
- Gate de calidad por app (lo que corre el CI): api = `prisma generate`+`prisma validate`+`tsc --noEmit`+`build`+`test:sprint4`+`test:sprint5`; web = `lint`+`tsc --noEmit`+`build`.

---

### Task 1: Validador v1 restaurado (catálogos + `encuestaV1Schema`)

**Files:**
- Modify: `api/src/validators/encuestasIngestValidator.ts`
- Modify: `api/tests/sprint5/fixtures.ts`
- Test: `api/tests/sprint5/encuestas-validator.test.ts`

**Interfaces:**
- Consumes: helpers ya existentes en el archivo: `fechaIso`, `textoCorto`, `ubicacionSchema`, `camposComunes`, `TOLERANCIA_DURACION_SEG`, `UUID_RE`, `FOLIO_LOCAL_RE`.
- Produces (exports nuevos): `PERSONAS_V1`, `NIVELES_CONOCIMIENTO_V1`, `MEDIOS_V1`, `PARTIDOS_V1`, `RANGOS_EDAD_V1`, `GENEROS_V1`, `encuestaV1Schema`, `type EncuestaV1 = z.infer<typeof encuestaV1Schema>`. Fixtures nuevas: `encuestaV1CompletaValida(overrides?)`, `encuestaV1NoElegibleValida(overrides?)`.

- [ ] **Step 1: Recuperar el material v1 del historial a archivos de consulta**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git show fd8294a:api/src/validators/encuestasIngestValidator.ts > /tmp/claude-1000/-mnt-c-Users-paulo-Claude-Code-flotillas-v2/c7458bc2-db49-4886-a3cc-129138f5e90f/scratchpad/v1-validator.ts
git show fd8294a:api/tests/sprint5/encuestas-validator.test.ts > /tmp/claude-1000/-mnt-c-Users-paulo-Claude-Code-flotillas-v2/c7458bc2-db49-4886-a3cc-129138f5e90f/scratchpad/v1-validator.test.ts
git show fd8294a:api/tests/sprint5/fixtures.ts > /tmp/claude-1000/-mnt-c-Users-paulo-Claude-Code-flotillas-v2/c7458bc2-db49-4886-a3cc-129138f5e90f/scratchpad/v1-fixtures.ts
```

- [ ] **Step 2: Añadir las fixtures v1 a `api/tests/sprint5/fixtures.ts`**

Copiar de `v1-fixtures.ts` las dos funciones `encuestaCompletaValida` y `encuestaNoElegibleValida` COMPLETAS (con sus docstrings) y pegarlas al final del archivo actual **renombradas** a `encuestaV1CompletaValida` y `encuestaV1NoElegibleValida` (la actual `encuestaCompletaValida` es la v3 y no se toca). Conservan `versionCuestionario: 1`, `elegibilidad`, y el bloque `respuestas` v1 (`credencialVigente`, `rangoEdad: '30_44'`, `genero`, `partidoPreferido`, `conocimientoPorPersona` de 7, `mediosConocimiento`, `mayorPersonalidad`, `candidatoPreferido`). Reutilizan las consts locales existentes `DISPOSITIVO` y `SINCRONIZACION` del archivo actual.

- [ ] **Step 3: Restaurar los tests v1 del validador (failing)**

En `api/tests/sprint5/encuestas-validator.test.ts` (el actual, v3): añadir al final un `describe('encuestaV1Schema (cuestionario restaurado)')` con los casos del archivo histórico `v1-validator.test.ts` que ejercitan v1, adaptando imports: fixtures → `encuestaV1CompletaValida`/`encuestaV1NoElegibleValida`, schema → `encuestaV1Schema`. Casos mínimos a restaurar (todos existen en el histórico; copiar sus cuerpos):
  - acepta la encuesta completada válida y la noElegible válida;
  - rechaza `rangoEdad`/`genero`/`partidoPreferido` fuera de catálogo v1;
  - `conocimientoPorPersona`: exige 7 personas, sin repetir, persona fuera de catálogo rechaza;
  - coherencia P5↔P6 en ambas direcciones (`respondida` sin conocer a nadie → rechaza; `omitidaPorLogica` conociendo a alguien → rechaza); medios repetidos → rechaza;
  - rama noElegible: `credencialVigente: 'no'` + `conocimientoPorPersona: []`; P2–P8 coladas se estripan (parse OK y no aparecen en `data`);
  - `estado`/`elegibilidad` incoherentes entre ramas → rechaza (p. ej. `estado: 'completada'` con `elegibilidad: 'noElegible'`);
  - coherencia fechas/duración (mismos casos que v3 pero sobre el schema v1).

- [ ] **Step 4: Correr los tests y verificar que fallan**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-validator.test.ts > vitest-validator.log 2>&1"; tail -40 vitest-validator.log
```
Esperado: FAIL — `encuestaV1Schema` no existe (error de import/compilación).

- [ ] **Step 5: Restaurar la sección v1 en `encuestasIngestValidator.ts`**

Del archivo de consulta `v1-validator.ts`, copiar al validador actual (en una sección nueva `// --- Cuestionario v1 (restaurado) ---` después de `encuestaV3Schema`):
  - los 6 catálogos v1 (`PERSONAS_V1`, `NIVELES_CONOCIMIENTO_V1`, `MEDIOS_V1`, `PARTIDOS_V1`, `RANGOS_EDAD_V1`, `GENEROS_V1`) — exportados, con su comentario original; ubicarlos junto a los catálogos v3 (líneas 44-65 actuales) para que todos los catálogos queden contiguos;
  - `personaV1`, `conocimientoPorPersonaSchema`, `mediosConocimientoSchema`, `respuestasCompletadaSchema` (renombrar a `respuestasCompletadaV1Schema`), `respuestasNoElegibleSchema` (renombrar a `respuestasNoElegibleV1Schema`) — cuerpos textuales del histórico;
  - `ramaCompletada`/`ramaNoElegible` (renombrar a `ramaCompletadaV1`/`ramaNoElegibleV1`): usan `{...camposComunes, versionCuestionario: z.literal(1), estado: ..., elegibilidad: ..., respuestas: ...}` — el spread de `camposComunes` actual trae `versionCuestionario: z.literal(3)`, así que la clave se **sobrescribe después del spread**;
  - `encuestaV1Schema` = `z.discriminatedUnion('estado', [ramaCompletadaV1, ramaNoElegibleV1]).superRefine(...)` con el MISMO cuerpo de coherencia fechas/duración que el v3. Para no duplicarlo, extraer el cuerpo del `.superRefine` actual de `encuestaV3Schema` a una función module-level `coherenciaFechasDuracion(d, ctx)` tipada con `{ fechaHoraInicio: unknown; fechaHoraFinalizacion: unknown; duracionSegundos: unknown }` + `z.core.$RefinementCtx`, y usarla en ambos schemas (comportamiento idéntico, mensajes idénticos);
  - `export type EncuestaV1 = z.infer<typeof encuestaV1Schema>;`
  - NO copiar del histórico: `ubicacionV1Schema` ni sus ramas (se reutiliza el `ubicacionSchema` compartido actual, que es idéntico), ni `camposComunes`, ni helpers.
  - Actualizar el comentario de cabecera del archivo: el dispatch del router ahora acepta 1 y 3.

- [ ] **Step 6: Correr los tests del validador y verificar que pasan (v3 incluidos)**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-validator.test.ts > vitest-validator.log 2>&1"; tail -40 vitest-validator.log
```
Esperado: PASS completo (los describe v3 existentes no deben moverse ni fallar).

- [ ] **Step 7: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/validators/encuestasIngestValidator.ts api/tests/sprint5/fixtures.ts api/tests/sprint5/encuestas-validator.test.ts
git commit -m "feat(encuestas): restaura el validador del cuestionario v1 junto al v3"
```

---

### Task 2: Migración aditiva + modelo Prisma

**Files:**
- Create: `api/prisma/migrations/20260806120000_restore_encuestas_v1/migration.sql`
- Modify: `api/prisma/schema.prisma` (modelo `Encuesta`, enums)

**Interfaces:**
- Produces: columnas nullables `elegibilidad` (enum `EncuestaElegibilidad?`), `credencialVigente`, `genero`, `partidoPreferido`, `mayorPersonalidad`, `candidatoPreferido` (`String?`), `conocimientoPorPersona`, `mediosConocimiento` (`Json?`); enum `EncuestaEstado` con `noElegible` de vuelta. Los usan Task 4 (service) y Task 6 (export).

- [ ] **Step 1: Escribir la migración**

Contenido íntegro de `migration.sql`:

```sql
-- Restaura la recepción del cuestionario v1 JUNTO al v3 (spec
-- 2026-08-06-encuestas-v1-restaurada-design.md). Aditiva: SIN
-- TRUNCATE/DELETE/DROP TABLE (gate scripts/check-qa-migrations-safe.js).
-- Re-crea lo que 20260805120000_encuestas_v3 eliminó, pero ahora NULLABLE:
-- en la convivencia v1+v3 cada fila solo llena las columnas de su versión.

-- La rama noElegible vuelve al contrato (P1 = "no" termina la encuesta).
-- PG16 permite ADD VALUE en transacción mientras el valor no se use en la
-- misma migración; aquí solo se declara.
ALTER TYPE "EncuestaEstado" ADD VALUE IF NOT EXISTS 'noElegible';

-- Elegibilidad del registro (la app la manda explícita, atada al estado).
CREATE TYPE "EncuestaElegibilidad" AS ENUM ('elegible', 'noElegible');

-- Respuestas v1. Catálogos como TEXT validado en la app (no enums de
-- Postgres), igual que las columnas v3. NULL = fila de la otra versión.
-- rango_edad NO se re-crea: la columna existente se comparte entre versiones
-- (catálogos disjuntos; version_cuestionario desambigua).
ALTER TABLE "encuestas"
  ADD COLUMN "elegibilidad" "EncuestaElegibilidad",
  ADD COLUMN "credencial_vigente" TEXT,
  ADD COLUMN "genero" TEXT,
  ADD COLUMN "partido_preferido" TEXT,
  ADD COLUMN "conocimiento_por_persona" JSONB,
  ADD COLUMN "medios_conocimiento" JSONB,
  ADD COLUMN "mayor_personalidad" TEXT,
  ADD COLUMN "candidato_preferido" TEXT;
```

- [ ] **Step 2: Actualizar `schema.prisma`**

En el enum (línea ~976) volver a:

```prisma
enum EncuestaEstado {
  completada
  noElegible
}

enum EncuestaElegibilidad {
  elegible
  noElegible
}
```

En el modelo `Encuesta`, después de `estado EncuestaEstado` añadir:

```prisma
  /// v1: la app la manda explícita, atada al estado. NULL = fila v3.
  elegibilidad                EncuestaElegibilidad?
```

y después del bloque de respuestas v3 (tras `aprobacionPorGobernante`):

```prisma
  /// Respuestas v1 (cuestionario restaurado). NULL = fila v3. En la rama
  /// noElegible solo se llena credencialVigente (P2–P8 no se almacenan).
  /// rangoEdad NO se duplica: la columna se comparte con v3 (catálogos
  /// disjuntos; versionCuestionario desambigua).
  credencialVigente           String?              @map("credencial_vigente")
  genero                      String?
  partidoPreferido            String?              @map("partido_preferido")
  conocimientoPorPersona      Json?                @map("conocimiento_por_persona")
  mediosConocimiento          Json?                @map("medios_conocimiento")
  mayorPersonalidad           String?              @map("mayor_personalidad")
  candidatoPreferido          String?              @map("candidato_preferido")
```

- [ ] **Step 3: Validar y regenerar el client**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx prisma validate > prisma.log 2>&1 && npx prisma generate >> prisma.log 2>&1"; tail -20 prisma.log
node ../scripts/check-qa-migrations-safe.js 2>/dev/null || cmd.exe /c "node scripts\\check-qa-migrations-safe.js" || true
```
Esperado: `The schema ... is valid`, generate OK. Correr el gate de migraciones desde la raíz si el script existe ahí (`ls scripts/`): debe pasar.

- [ ] **Step 4: Verificar que la API sigue compilando**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx tsc --noEmit > tsc.log 2>&1"; tail -20 tsc.log
```
Esperado: sin errores (las columnas nuevas son opcionales; el código v3 no cambia).

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/prisma/schema.prisma api/prisma/migrations/20260806120000_restore_encuestas_v1/migration.sql
git commit -m "feat(encuestas): migración aditiva que restaura las columnas v1"
```

---

### Task 3: Canonicalización y hash v1 (`v: 1`)

**Files:**
- Modify: `api/src/lib/encuestasCanonical.ts`
- Test: `api/tests/sprint5/encuestas-canonical-hash.test.ts`

**Interfaces:**
- Consumes: `PERSONAS_V1`, `MEDIOS_V1`, `type EncuestaV1` (Task 1); `ubicacionCanonica` existente (compartida: la forma de `ubicacion` es idéntica entre versiones).
- Produces: `canonicalizarEncuestaV1(d: EncuestaV1): string`, `hashEncuestaV1(d: EncuestaV1): string`. Los usa el router (Task 5) y los tests de servicio (Task 4).

- [ ] **Step 1: Restaurar tests del hash v1 (failing)**

Fuente histórica: `git show fd8294a:api/tests/sprint5/encuestas-canonical-hash.test.ts` (guardar en el scratchpad como `v1-hash.test.ts`). Añadir al test actual un `describe('canonicalización v1 (restaurada)')` con los casos históricos adaptados a las fixtures nuevas (`encuestaV1CompletaValida`/`encuestaV1NoElegibleValida`, parseadas con `encuestaV1Schema` antes de hashear):
  - mismo contenido ⇒ mismo hash; reordenar `conocimientoPorPersona` y `medios` ⇒ mismo hash;
  - cambiar un campo sustantivo (p. ej. `respuestas.partidoPreferido`) ⇒ hash distinto;
  - los campos de sincronización y `idRemoto` no afectan el hash;
  - la forma canónica lleva `"v":1` (y la v3 sigue llevando `"v":2`): `expect(JSON.parse(canonicalizarEncuestaV1(parsed)).v).toBe(1)`;
  - rama noElegible: canónico con `conocimientoPorPersona: []` y sin P2–P8.

- [ ] **Step 2: Verificar que fallan**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-canonical-hash.test.ts > vitest-hash.log 2>&1"; tail -30 vitest-hash.log
```
Esperado: FAIL — `canonicalizarEncuestaV1` no existe.

- [ ] **Step 3: Restaurar la canonicalización v1**

En `encuestasCanonical.ts` (fuente: `git show fd8294a:api/src/lib/encuestasCanonical.ts`):
  - añadir `const VERSION_CANONICA_V1 = 1;` junto al `VERSION_CANONICA = 2` actual, con comentario: la versión canónica es POR CUESTIONARIO — los hashes v1 guardados antes del reemplazo deben seguir coincidiendo;
  - restaurar `respuestasCanonicas` del histórico renombrada a `respuestasCanonicasV1` (rama noElegible ⇒ `{credencialVigente, conocimientoPorPersona: []}`; rama completada ⇒ reorden por `PERSONAS_V1` y filtro de `MEDIOS_V1`);
  - restaurar `canonicalizarEncuestaV1` y `hashEncuestaV1` textuales (con `v: VERSION_CANONICA_V1`, `estado` y `elegibilidad` en el objeto canónico, mismo orden de claves del histórico);
  - reutilizar la `ubicacionCanonica` existente (no duplicarla): su parámetro acepta la ubicación de ambas versiones — si TS se queja del tipo, cambiar la firma a `EncuestaV1['ubicacion'] | EncuestaV3['ubicacion']` (estructuralmente idénticos);
  - imports nuevos: `PERSONAS_V1`, `MEDIOS_V1`, `type EncuestaV1`.

- [ ] **Step 4: Correr y verificar que pasan (v3 incluidos)**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-canonical-hash.test.ts > vitest-hash.log 2>&1"; tail -30 vitest-hash.log
```
Esperado: PASS completo.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/lib/encuestasCanonical.ts api/tests/sprint5/encuestas-canonical-hash.test.ts
git commit -m "feat(encuestas): hash canónico v1 restaurado con su v:1 original"
```

---

### Task 4: Servicio de ingesta con dispatch por versión

**Files:**
- Modify: `api/src/services/encuestasIngestService.ts`
- Test: `api/tests/sprint5/encuestas-ingest-service.test.ts`

**Interfaces:**
- Consumes: `type EncuestaV1`, `PERSONAS_V1`, `MEDIOS_V1` (Task 1); client Prisma regenerado (Task 2); `hashEncuestaV1` (Task 3, solo en tests).
- Produces: `IngestEncuestaInput.parsed` pasa a ser `EncuestaV1 | EncuestaV3`; `ingestEncuesta`/`ingestEncuestaWithDeps` sin cambio de firma externa. Lo consume el router (Task 5).

- [ ] **Step 1: Restaurar tests v1 del servicio (failing)**

Fuente: `git show fd8294a:api/tests/sprint5/encuestas-ingest-service.test.ts`. Añadir al test actual un `describe('ingesta v1 (restaurada)')`:
  - alta v1 completada: la fila lleva `versionCuestionario: 1`, `elegibilidad: 'elegible'`, `credencialVigente: 'si'`, `conocimientoPorPersona` reordenado al orden de `PERSONAS_V1`, `medios` filtrados al orden de `MEDIOS_V1`, y las columnas v3 (`sexo`, `conoceLalo`, `aprobacionPorGobernante`, …) ausentes/NULL;
  - alta v1 noElegible: `estado: 'noElegible'`, `elegibilidad: 'noElegible'`, `credencialVigente: 'no'` y `conocimientoPorPersona`/`mediosConocimiento` con `Prisma.DbNull`;
  - reenvío idéntico ⇒ `{created: false}` con el idRemoto original; mismo `idLocal` con hash distinto ⇒ `Conflict` (los cuerpos de estos casos están en el histórico; adaptar fixture y schema v1).
  - Una alta v3 en el mismo describe de al lado debe seguir pasando sin tocar (no editar los tests v3).

- [ ] **Step 2: Verificar que fallan**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-ingest-service.test.ts > vitest-service.log 2>&1"; tail -30 vitest-service.log
```
Esperado: FAIL — `parsed` no admite `EncuestaV1` (error de tipos) o columnas v1 sin escribir.

- [ ] **Step 3: Implementar el dispatch en el servicio**

En `encuestasIngestService.ts`:
  - `IngestEncuestaInput.parsed: EncuestaV1 | EncuestaV3` (import de ambos tipos + `PERSONAS_V1`, `MEDIOS_V1`);
  - renombrar `respuestasRow` → `respuestasRowV3` y su tipo `RespuestasRow` → `RespuestasV3Row` (solo dentro del archivo);
  - restaurar del histórico (`git show fd8294a:api/src/services/encuestasIngestService.ts`) la `respuestasRow` v1 como `respuestasRowV1` con su tipo:

```ts
type RespuestasV1Row = Pick<
  Prisma.EncuestaUncheckedCreateInput,
  | 'credencialVigente'
  | 'rangoEdad'
  | 'genero'
  | 'partidoPreferido'
  | 'conocimientoPorPersona'
  | 'mediosConocimiento'
  | 'mayorPersonalidad'
  | 'candidatoPreferido'
>;
```

  (cuerpo textual del histórico: rama noElegible con `Prisma.DbNull` en las dos JSONB y `null` en los escalares; rama completada con el reorden por catálogo);
  - en `mapEncuestaToRow`, despachar por la discriminante del contrato:

```ts
function mapEncuestaToRow(input: IngestEncuestaInput): Prisma.EncuestaUncheckedCreateInput {
  const d = input.parsed;
  const esV1 = d.versionCuestionario === 1;
  return {
    idLocal: d.idLocal,
    dispositivoId: input.dispositivoId,
    payloadHash: input.payloadHash,
    versionCuestionario: d.versionCuestionario,
    folioLocal: d.folioLocal ?? null,
    encuestador: d.encuestador ?? null,
    estado: d.estado,
    // v1 la manda explícita (atada al estado por el validador); en v3 el
    // concepto no existe y la columna queda NULL.
    elegibilidad: esV1 ? d.elegibilidad : null,
    fechaHoraInicio: d.fechaHoraInicio,
    fechaHoraFinalizacion: d.fechaHoraFinalizacion,
    duracionSegundos: d.duracionSegundos,
    ...(esV1 ? respuestasRowV1(d) : respuestasRowV3(d)),
    ...ubicacionRow(d.ubicacion),
    dispositivoPlataforma: d.dispositivo.plataforma,
    dispositivoModelo: d.dispositivo.modelo,
    dispositivoVersionSistema: d.dispositivo.versionSistema,
    versionAplicacion: d.versionAplicacion,
    payloadRaw: input.payloadRaw,
  };
}
```

  (con `esV1` como narrowing: si TS no estrecha por `versionCuestionario`, usar `if/else` explícito y construir el spread en una variable tipada `RespuestasV1Row | RespuestasV3Row`);
  - `ubicacionRow` acepta ambas versiones: cambiar su firma a `EncuestaV1['ubicacion'] | EncuestaV3['ubicacion']` (idénticas estructuralmente);
  - actualizar el comentario de cabecera (ya no es "encuesta v3", es la ingesta de ambos cuestionarios).

- [ ] **Step 4: Correr y verificar que pasan (v3 incluidos)**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-ingest-service.test.ts > vitest-service.log 2>&1"; tail -30 vitest-service.log
```
Esperado: PASS completo.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/services/encuestasIngestService.ts api/tests/sprint5/encuestas-ingest-service.test.ts
git commit -m "feat(encuestas): el servicio de ingesta despacha v1 y v3"
```

---

### Task 5: Router — dispatch de versión 1|3

**Files:**
- Modify: `api/src/routes/encuestasIngestRouter.ts`
- Test: `api/tests/sprint5/encuestas-ingest-http.test.ts`

**Interfaces:**
- Consumes: `encuestaV1Schema`, `encuestaV3Schema`, `hashEncuestaV1`, `hashEncuestaV3`, `ingestEncuesta` (Tasks 1, 3, 4).
- Produces: contrato HTTP — `versionCuestionario: 1` y `3` → 201/200/409/422 según el flujo; `2`, `4`, etc. → 422 `UNSUPPORTED_VERSION`.

- [ ] **Step 1: Añadir tests HTTP v1 (failing)**

Fuente histórica: `git show fd8294a:api/tests/sprint5/encuestas-ingest-http.test.ts`. En el test actual, añadir `describe('ingesta HTTP v1 (restaurada)')`:
  - POST con `encuestaV1CompletaValida()` ⇒ 201 con `{idRemoto}`; reenvío idéntico ⇒ 200 mismo `idRemoto`; mismo `idLocal` con contenido distinto ⇒ 409;
  - POST con `encuestaV1NoElegibleValida()` ⇒ 201;
  - payload v1 con `respuestas.partidoPreferido: 'verde'` (fuera de catálogo) ⇒ 422 `VALIDATION_ERROR`;
  - `versionCuestionario: 2` ⇒ 422 `UNSUPPORTED_VERSION` (ajustar el test existente si hoy afirma que `1` también es no soportada — ese caso CAMBIA de expectativa: `1` ahora es 201).

- [ ] **Step 2: Verificar que fallan**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-ingest-http.test.ts > vitest-http.log 2>&1"; tail -30 vitest-http.log
```
Esperado: FAIL — el POST v1 recibe 422 `UNSUPPORTED_VERSION`.

- [ ] **Step 3: Implementar el dispatch**

En `encuestasIngestRouter.ts`, reemplazar `VERSION_SOPORTADA` y el bloque de dispatch + parse + hash (líneas ~24-126) por:

```ts
/** Versiones de cuestionario que este servidor sabe persistir. */
const VERSIONES_SOPORTADAS = [1, 3] as const;
```

y dentro del handler, tras el check de entero positivo (que no cambia):

```ts
    if (!VERSIONES_SOPORTADAS.includes(versionCuestionario as 1 | 3)) {
      res.status(422).json({
        error: 'Versión de cuestionario no soportada',
        code: 'UNSUPPORTED_VERSION',
        details: { versionCuestionario },
        requestId: requestIdDe(res),
      });
      return;
    }

    // Cada versión valida y hashea con su propio schema/canónico; el resto del
    // flujo (idempotencia, respuesta) es común.
    const resultado =
      versionCuestionario === 1
        ? (() => {
            const p = encuestaV1Schema.safeParse(body);
            return p.success
              ? { ok: true as const, parsed: p.data, payloadHash: hashEncuestaV1(p.data) }
              : { ok: false as const, issues: p.error.issues };
          })()
        : (() => {
            const p = encuestaV3Schema.safeParse(body);
            return p.success
              ? { ok: true as const, parsed: p.data, payloadHash: hashEncuestaV3(p.data) }
              : { ok: false as const, issues: p.error.issues };
          })();

    if (!resultado.ok) {
      res.status(422).json({
        error: 'Datos inválidos',
        code: 'VALIDATION_ERROR',
        issues: resultado.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
        requestId: requestIdDe(res),
      });
      return;
    }

    const payloadRaw = JSON.stringify(req.body);
    const { idRemoto, created } = await ingestEncuesta({
      parsed: resultado.parsed,
      dispositivoId: req.encuestaDevice!.id,
      payloadHash: resultado.payloadHash,
      payloadRaw,
    });

    res.status(created ? 201 : 200).json({ idRemoto });
```

Imports nuevos: `encuestaV1Schema`, `hashEncuestaV1`. Actualizar el comentario del dispatch (una v2 sigue mereciendo `UNSUPPORTED_VERSION`).

- [ ] **Step 4: Correr y verificar que pasan (v3 incluidos)**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-ingest-http.test.ts > vitest-http.log 2>&1"; tail -30 vitest-http.log
```
Esperado: PASS completo.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/routes/encuestasIngestRouter.ts api/tests/sprint5/encuestas-ingest-http.test.ts
git commit -m "feat(encuestas): el endpoint de ingesta acepta v1 y v3"
```

---

### Task 6: Revisión y CSV — unión de columnas

**Files:**
- Modify: `api/src/services/encuestasRevisionService.ts`
- Test: `api/tests/sprint5/encuestas-export-http.test.ts`, `api/tests/sprint5/encuestas-revision-lectura.test.ts`

**Interfaces:**
- Consumes: `PERSONAS_V1`, `GOBERNANTES_V3` (validador); columnas Prisma (Task 2).
- Produces: `EncuestaDto` con `partidoPreferido: string | null` y `candidatoPreferido: string | null` (los usa Task 7); `ENCUESTAS_CSV_HEADERS` con 51 columnas (36 v3 + 15 v1); `EncuestaExportRow` con los campos v1.

- [ ] **Step 1: Actualizar tests de export/lectura (failing)**

Fuente histórica de helpers v1: `git show fd8294a:api/src/services/encuestasRevisionService.ts` y `git show fd8294a:api/tests/sprint5/encuestas-export-http.test.ts`. En los tests actuales:
  - export: añadir un caso con una fila v1 sembrada (mock del iterador o de prisma, como hagan los tests actuales) que verifique: la cabecera tiene 51 columnas en el orden del Step 2, la fila v1 llena `Elegibilidad`, `Credencial vigente`, `Género`, `Partido preferido`, las 7 `Conoce <persona>`, `Medios (tipo)`, `Medios`, `Mayor personalidad`, `Candidato preferido`, y deja vacías las v3 (`Sexo`, `Conoce Lalo`, `Aprobación *`, …); una fila v3 hace lo inverso;
  - lectura: el DTO del listado incluye `partidoPreferido` y `candidatoPreferido` (null en filas v3) y sigue SIN `payloadRaw`/`payloadHash`.

- [ ] **Step 2: Implementar la unión en `encuestasRevisionService.ts`**

  - `EncuestaDto`: añadir `partidoPreferido: string | null; candidatoPreferido: string | null;` (con comentario: equivalentes v1 de las preferencias v3, para que el listado muestre el dato de cada versión). Añadirlos también a `encuestaListSelect` y a `toDto`.
  - `EncuestaExportRow`: añadir `elegibilidad: EncuestaElegibilidad | null; credencialVigente: string | null; genero: string | null; partidoPreferido: string | null; conocimientoPorPersona: unknown; mediosConocimiento: unknown; mayorPersonalidad: string | null; candidatoPreferido: string | null;` y los mismos 8 en `encuestaExportSelect` (import de `EncuestaElegibilidad` desde `@prisma/client`).
  - `ENCUESTAS_CSV_HEADERS` pasa a 51 columnas, en este orden exacto (v3 como base, columnas v1 intercaladas donde son legibles):

```ts
export const ENCUESTAS_CSV_HEADERS = [
  'ID remoto', 'ID local', 'Folio', 'Encuestador',
  'Recibido (UTC)', 'Inicio (UTC)', 'Finalización (UTC)', 'Duración (s)',
  'Estado', 'Elegibilidad', 'Versión cuestionario',
  'Credencial vigente', 'Sexo', 'Rango edad', 'Género', 'Partido preferido',
  'Empresarios conocidos', 'Políticos conocidos',
  'Conoce Lalo', 'Rol Lalo', 'Opinión Lalo',
  'Preferencia electoral', 'Preferencia partido',
  'Aprobación sheinbaum', 'Aprobación jara', 'Aprobación huerta',
  'Conoce lalo_ximenez', 'Conoce laura_estrada', 'Conoce paco_nino',
  'Conoce gabriela_delgado', 'Conoce irineo_molina', 'Conoce goyo_castaneda',
  'Conoce ernesto_montero', 'Medios (tipo)', 'Medios',
  'Mayor personalidad', 'Candidato preferido',
  'Ubicación disponible', 'Latitud', 'Longitud', 'Precisión (m)',
  'Ubicación válida', 'Captura GPS (UTC)', 'Permiso ubicación',
  'Servicio ubicación activo', 'Motivo no disponible',
  'Plataforma', 'Modelo', 'Versión sistema', 'Versión app', 'Dispositivo',
] as const;
```

  (El test debe afirmar `ENCUESTAS_CSV_HEADERS.length === 51`, y `toCsvRow` debe emitir exactamente ese número de celdas en ese orden.)
  - Restaurar del histórico los helpers v1 `nivelesPorPersona(valor: unknown): Map<string, string>` (pivoteo del JSONB de P5, tolerante a formas anómalas, igual que `calificacionesPorGobernante`) y `celdasDeMedios(valor: unknown): [string, string]` (devuelve `['respondida', 'redes_sociales;labor_social']` o `['omitidaPorLogica', '']` o `['', '']` si NULL).
  - `toCsvRow`: intercalar las celdas nuevas en el MISMO orden que las cabeceras: `encuesta.elegibilidad` tras `encuesta.estado`; `encuesta.credencialVigente` tras `versionCuestionario`; `encuesta.genero` y `encuesta.partidoPreferido` tras `rangoEdad`; las 7 de P5 (`...PERSONAS_V1.map((p) => niveles.get(p) ?? '')`), `mediosTipo`, `mediosLista`, `mayorPersonalidad`, `candidatoPreferido` tras las 3 de aprobación; el resto igual.
  - Actualizar los comentarios que digan "CSV v3 con 36 cabeceras".

- [ ] **Step 3: Correr y verificar que pasan**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint5/encuestas-export-http.test.ts tests/sprint5/encuestas-revision-lectura.test.ts > vitest-export.log 2>&1"; tail -30 vitest-export.log
```
Esperado: PASS completo.

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add api/src/services/encuestasRevisionService.ts api/tests/sprint5/encuestas-export-http.test.ts api/tests/sprint5/encuestas-revision-lectura.test.ts
git commit -m "feat(encuestas): revisión y CSV con la unión de columnas v1+v3"
```

---

### Task 7: Frontend — versión y preferencias por equivalencia

**Files:**
- Modify: `web/src/hooks/useEncuestas.ts`
- Modify: `web/src/app/revision/encuestas/page.tsx`

**Interfaces:**
- Consumes: DTO de la API con `partidoPreferido`/`candidatoPreferido` (Task 6).
- Produces: UI — columna "Versión"; columnas de preferencia que muestran el dato de la versión de cada fila.

**Nota:** `web/AGENTS.md` obliga a leer la guía relevante en `web/node_modules/next/dist/docs/` antes de escribir código de Next. Este task solo toca un client component y un hook (sin APIs nuevas de Next), pero el ejecutor debe respetar esa regla si duda de cualquier convención.

- [ ] **Step 1: Ampliar la interfaz `Encuesta` del hook**

En `useEncuestas.ts`, dentro de `export interface Encuesta`, después de `preferenciaPartido`:

```ts
  // Equivalentes v1 (cuestionario restaurado): null en filas v3.
  partidoPreferido: string | null;
  candidatoPreferido: string | null;
```

- [ ] **Step 2: Columnas del listado**

En `page.tsx`:
  - añadir la columna Versión justo antes de la de `preferenciaElectoral`:

```tsx
  {
    accessorKey: 'versionCuestionario',
    header: 'Versión',
    cell: ({ row }) => (
      <span className="font-mono text-sm">v{row.original.versionCuestionario}</span>
    ),
  },
```

  - en la celda de `preferenciaElectoral`: `cell: ({ row }) => row.original.preferenciaElectoral ?? row.original.candidatoPreferido ?? '—',` con comentario `// v3 manda preferenciaElectoral; una fila v1 trae su equivalente candidatoPreferido.`
  - en la celda de `preferenciaPartido`: `cell: ({ row }) => row.original.preferenciaPartido ?? row.original.partidoPreferido ?? '—',` con el comentario equivalente.
  - la celda de `conoceLalo` ya muestra '—' con null: no tocarla.

- [ ] **Step 3: Verificar con el gate de web**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/web" && cmd.exe /c "npx tsc --noEmit > tsc.log 2>&1"; tail -20 tsc.log
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/web" && cmd.exe /c "npm run lint > lint.log 2>&1"; tail -20 lint.log
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/web" && cmd.exe /c "npm run build > build.log 2>&1"; tail -20 build.log
```
Esperado: los tres sin errores.

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add web/src/hooks/useEncuestas.ts web/src/app/revision/encuestas/page.tsx
git commit -m "feat(encuestas): listado de revisión con versión y preferencias v1"
```

---

### Task 8: Documentación — guía y OpenAPI con ambos contratos

**Files:**
- Modify: `docs/encuestas-okrean.md`
- Modify: `docs/encuestas-okrean-openapi.yaml`

**Interfaces:**
- Consumes: contrato final de Tasks 1-6 (catálogos, dispatch, CSV).
- Produces: documentación consumible por Okrean y el revisor; nada de código depende de esto.

- [ ] **Step 1: Guía (`docs/encuestas-okrean.md`)**

Fuente histórica: `git show fd8294a:docs/encuestas-okrean.md` (la versión que documentaba el v1). Cambios:
  - en la sección del contrato, declarar que el servidor acepta **dos versiones** (`versionCuestionario: 1` y `3`) y qué schema aplica a cada una; restaurar del histórico la tabla de campos/catálogos v1 como subsección "Contrato v1 (cuestionario restaurado)" tras la v3, incluidas las ramas `completada`/`noElegible` y la coherencia P5↔P6;
  - códigos de respuesta: `UNSUPPORTED_VERSION` ahora es para versiones ∉ {1, 3};
  - diccionario de datos: añadir las columnas v1 restauradas con la nota de que NULL = fila de la otra versión, y en `rango_edad` la nota de columna compartida (catálogos disjuntos; `version_cuestionario` desambigua);
  - CSV: actualizar la lista de columnas a la unión de Task 6 (mismo orden).

- [ ] **Step 2: OpenAPI (`docs/encuestas-okrean-openapi.yaml`)**

Fuente histórica: `git show fd8294a:docs/encuestas-okrean-openapi.yaml`. Restaurar el schema del payload v1 como `EncuestaV1` (con sus dos ramas como `oneOf` por `estado`, o como lo modelaba el histórico) y declarar el request body del POST como `oneOf: [EncuestaV1, EncuestaV3]` discriminado por `versionCuestionario`. Añadir un ejemplo v1 (tomar el de la fixture `encuestaV1CompletaValida`). Mantener la nota de que la fuente de verdad es `encuestasIngestValidator.ts`.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2"
git add docs/encuestas-okrean.md docs/encuestas-okrean-openapi.yaml
git commit -m "docs(encuestas): contrato v1 restaurado junto al v3 en guía y OpenAPI"
```

---

### Task 9: Verificación final integral

**Files:**
- Ninguno nuevo (solo verificación; fixes puntuales si algo falla).

- [ ] **Step 1: Gate completo de la API**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx prisma validate > gate.log 2>&1 && npx tsc --noEmit >> gate.log 2>&1 && npm run build >> gate.log 2>&1"; tail -30 gate.log
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/api" && cmd.exe /c "npx vitest run tests/sprint4 tests/sprint5 > vitest-all.log 2>&1"; tail -40 vitest-all.log
```
Esperado: todo verde, incluidos los sprints anteriores (sin regresiones).

- [ ] **Step 2: Gate completo de web**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2/web" && cmd.exe /c "npm run lint > gate.log 2>&1 && npx tsc --noEmit >> gate.log 2>&1 && npm run build >> gate.log 2>&1"; tail -30 gate.log
```
Esperado: verde.

- [ ] **Step 3: Gate de migraciones seguras**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2" && ls scripts/ | grep -i migr
# correr el script que exista (check-qa-migrations-safe.js) con node vía cmd.exe si hace falta
```
Esperado: la migración `20260806120000_restore_encuestas_v1` pasa (es puramente aditiva).

- [ ] **Step 4: Revisión de residuos**

`git grep -n "solo acepta 3\|VERSION_SOPORTADA\b\|36 cabeceras\|única versión" api/src docs` — cero resultados que contradigan la convivencia v1+v3.

- [ ] **Step 5: Commit final (si hubo fixes) y cierre**

```bash
cd "/mnt/c/Users/paulo/Claude Code/flotillas-v2" && git status && git log --oneline main..HEAD
```
Con todo verde: invocar superpowers:finishing-a-development-branch (PR a `main`, mismo flujo que PR #7). Recordar en la descripción del PR el riesgo operativo del spec: si el VPS aún no corrió la migración v3 y tuviera filas v1, respaldar antes de desplegar.

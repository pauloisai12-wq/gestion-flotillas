# Encuestas Okrean — reaceptar el cuestionario v1 junto al v3

**Fecha:** 6 ago 2026 · **Estado:** aprobado por el usuario (diseño verbal) · **Módulo:** encuestas (ingesta `POST /api/v1/encuestas`)

## Contexto y decisión

El cuestionario v3 (PR #7, migración `20260805120000_encuestas_v3`) reemplazó por completo al v1
y el router hoy responde `422 UNSUPPORTED_VERSION` a cualquier `versionCuestionario ≠ 3`
(`api/src/routes/encuestasIngestRouter.ts`). El usuario necesita volver a recibir respuestas del
cuestionario original de 8 preguntas (PDF "ENCUESTAS LX", idéntico al contrato v1 que vive en el
historial de git, commit `fd8294a`).

Decisiones tomadas con el usuario:

1. **Conviven ambas versiones**: el endpoint acepta `versionCuestionario: 1` y `3`.
2. **Contrato v1 exacto**: la app manda el v1 tal como antes (mismos campos y catálogos);
   no se negocia contrato nuevo con Okrean.
3. **Visibilidad completa**: las encuestas v1 se ven en la pestaña `/revision/encuestas` y el
   CSV vuelve a exportar sus columnas.
4. **Enfoque elegido: resurrección completa desde git** (validador, servicio, hash y tests v1
   restaurados del historial), descartando la alternativa de una columna JSONB única — rompería
   el patrón columna-por-pregunta y desperdiciaría código ya probado.

## 1. Contrato y router

- `POST /api/v1/encuestas` despacha por versión ANTES del schema, como hoy:
  `1` → `encuestaV1Schema` (restaurado), `3` → `encuestaV3Schema` (actual), otra → `422 UNSUPPORTED_VERSION`.
- Sin cambios en: auth por API key de dispositivo, rate-limit por IP y por dispositivo,
  límite `256kb`, códigos de respuesta (201/200/400/401/403/405/409/413/422/429), `GET /ping`.
- La forma del error 422 inline con issues de zod se conserva; el dispatch nunca relanza ZodError.

## 2. Validador (`api/src/validators/encuestasIngestValidator.ts`)

Se restauran del commit `fd8294a`, conviviendo con lo v3 en el mismo archivo:

- Catálogos v1: `PERSONAS_V1` (lalo_ximenez, laura_estrada, paco_nino, gabriela_delgado,
  irineo_molina, goyo_castaneda, ernesto_montero), `NIVELES_CONOCIMIENTO_V1` (no_conoce, poco,
  algo, bien), `MEDIOS_V1` (redes_sociales, otras_personas, labor_social), `PARTIDOS_V1`
  (morena, pri, ninguno_no_sabe, prd, mc, pvem, pt, independiente, panal, pan),
  `RANGOS_EDAD_V1` (18_29, 30_44, 45_59, 60_mas), `GENEROS_V1` (hombre, mujer, otro).
- `encuestaV1Schema` completo con sus dos ramas discriminadas por `estado`:
  - `completada` (P1 credencial = "si"): P2–P8 obligatorias, P5 exactamente las 7 personas sin
    repetir, coherencia P5↔P6 en ambas direcciones (`mediosConocimiento` respondida ⇔ conoce a
    al menos una persona; `omitidaPorLogica` ⇔ no conoce a ninguna).
  - `noElegible` (P1 = "no"): la encuesta termina en P1; P2–P8 no viajan.
- Campos comunes (idLocal, folioLocal `LX-…`, encuestador opcional, fechas ISO, duración con
  tolerancia ±60 s, dispositivo, versionAplicacion, bloque `ubicacion` con unión discriminada)
  ya son idénticos entre v1 y v3: se comparten los helpers existentes, sin duplicar.
- Los campos de la cola de envío del teléfono siguen estripados por zod (no entran a hash ni a columnas).

## 3. Base de datos (Prisma + migración)

Migración nueva **aditiva** (p. ej. `20260806XXXXXX_restore_encuestas_v1`), sin
TRUNCATE/DELETE/DROP TABLE (pasa `scripts/check-qa-migrations-safe.js`):

- `ALTER TYPE "EncuestaEstado" ADD VALUE 'noElegible'` (vuelve la rama de elegibilidad).
- `CREATE TYPE "EncuestaElegibilidad"` como en la migración original `20260731120000`.
- `ALTER TABLE "encuestas" ADD COLUMN`: `elegibilidad` (enum), `credencial_vigente`,
  `genero`, `partido_preferido`, `mayor_personalidad`, `candidato_preferido` (TEXT),
  `conocimiento_por_persona`, `medios_conocimiento` (JSONB). **Todas NULLABLE** — la
  obligatoriedad la impone el validador; NULL es la representación natural de una fila
  de la otra versión.
- **`rango_edad` se comparte** entre v1 y v3: los catálogos no se traslapan
  (`18_29/30_44/45_59/60_mas` vs `18_30/31_45/46_mas`) y `version_cuestionario` desambigua.
  Queda documentado en el diccionario de datos de `docs/encuestas-okrean.md`.
- `schema.prisma`: modelo `Encuesta` recupera los campos v1 correspondientes.

## 4. Servicio e idempotencia (`encuestasIngestService.ts` + `encuestasCanonical.ts`)

- El servicio despacha por versión: se restaura `respuestasRow()` v1 (reorden canónico de P5 al
  orden de `PERSONAS_V1` y de medios al de `MEDIOS_V1`; `Prisma.DbNull` en las JSONB de la rama
  `noElegible`) junto al `respuestasRow()` v3 actual. El flujo idempotente
  (create → P2002 → findUnique → comparar hash → 200/409) no cambia.
- La canonicalización v1 se restaura **textual, con su `v: 1` original**; la v3 conserva
  `v: 2`. La versión canónica pasa a ser por-cuestionario, no global: si alguna fila v1 vieja
  sobreviviera en una BD, el reenvío del teléfono sigue dando 200 idempotente, no un 409 falso.
- `ubicacionRow()` y el resto del mapeo común se comparten sin duplicar.

## 5. Revisión y CSV

- **CSV de exportación**: unión de columnas v1 + v3. Vuelve el pivoteo determinista v1
  (conocimiento-por-persona en 7 columnas en el orden de `PERSONAS_V1`, medios en el orden de
  `MEDIOS_V1`, como el export original en el historial). Las filas de una versión dejan vacías
  las columnas de la otra. Tope de 50 000 filas y flujo HEAD→GET sin cambios.
- **Listado `/revision/encuestas`** (`web/src/app/revision/encuestas/page.tsx` +
  `web/src/hooks/useEncuestas.ts`): se agrega columna **Versión**; las columnas
  "Preferencia electoral" y "Preferencia partido" muestran el dato equivalente por versión
  (v1: `candidatoPreferido`/`partidoPreferido`; v3: `preferenciaElectoral`/`preferenciaPartido`);
  "Conoce a Lalo" muestra "—" en filas v1. El listado sigue sin traer `payloadRaw`/`payloadHash`
  ni los JSONB.

## 6. Documentación y tests

- `docs/encuestas-okrean.md`: se restaura la sección del contrato v1 (marcada como versión
  heredada re-aceptada) junto a la v3; diccionario de datos actualizado (incluida la nota de
  `rango_edad` compartida). `docs/encuestas-okrean-openapi.yaml`: schema `EncuestaV1` de vuelta
  junto a `EncuestaV3` (oneOf por `versionCuestionario`).
- Tests (`api/tests/sprint5/`, vitest, `npm run test:sprint5`, ya en CI): se restauran y adaptan
  los casos v1 del historial (validator con ambas ramas y coherencia P5↔P6, HTTP con dispatch de
  versiones 1/3/otras, service, hash canónico v1 con `v:1`, export con columnas de unión) sin
  quitar ninguno v3. Fixture v1 restaurada en `fixtures.ts`.
- En este entorno WSL, vitest y el build de web se corren vía `cmd.exe /c` con salida a log
  (binarios nativos de Windows en `node_modules`).

## Riesgos y notas operativas

- **Datos v1 preexistentes**: la migración v3 (ya en `main`) borra las columnas v1 al
  desplegarse; su comentario afirma que producción no tiene datos v1. Si el VPS tuviera filas v1
  reales y la migración v3 aún no se ha aplicado ahí, respaldar antes (`pg_dump`); re-crear las
  columnas NO resucita datos ya borrados (solo `payload_raw` los conserva como auditoría).
- `ALTER TYPE … ADD VALUE` no puede correr dentro de la misma transacción que use el valor
  nuevo en versiones viejas de Postgres; en PG16 es válido pero conviene que la migración lo
  haga en su propia sentencia inicial (Prisma ejecuta el .sql tal cual).
- Fuera de alcance: cambios en la app móvil, panel de análisis, y cualquier alteración de los
  catálogos v3.

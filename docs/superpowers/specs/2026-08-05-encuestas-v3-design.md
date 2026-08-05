# Encuestas Okrean — cuestionario v3 (diseño)

> Fecha: 2026-08-05 · Estado: aprobado (enfoque A)
> Reemplaza por completo el cuestionario v1 en la ingesta `/api/v1/encuestas` y
> en el portal de revisión. No hay datos v1 que conservar (el módulo no llegó a
> producción con capturas reales).

## 1. Contexto y alcance

La app móvil "Encuestas Okrean" pasa a enviar el cuestionario **v3**
(`versionCuestionario: 3`). El servidor:

- acepta **solo** v3: cualquier `versionCuestionario ≠ 3` → 422
  `UNSUPPORTED_VERSION` (mecanismo ya existente en el router);
- elimina del modelo y del contrato los campos v1: `credencialVigente`,
  `genero`, `partidoPreferido`, `conocimientoPorPersona`, `mediosConocimiento`,
  `mayorPersonalidad`, `candidatoPreferido` y la `elegibilidad` del registro;
- actualiza el portal de revisión (DTO del listado, CSV y página web) a los
  campos v3.

**Sin cambios**: contrato de respuesta de la ingesta (201/200 `{"idRemoto"}`,
idempotencia por `idLocal`, 409 por contenido distinto, 422 `{issues}`, 401,
429 con `Retry-After`, `GET /ping` → `{"ok":true}`, 405 en `GET /`), auth por
API key, rate-limits, límite de body 256 KB, y los campos comunes del registro
(`idLocal`, `folioLocal?`, `encuestador?`, fechas ISO, `duracionSegundos`,
`ubicacion?`, `dispositivo{...}`, `versionAplicacion`).

## 2. Contrato v3 — bloque `respuestas`

Todos los campos son **obligatorios**. No hay saltos de lógica: `rolLalo` y
`opinionLalo` se contestan siempre (sus catálogos ya incluyen
`no_sabe_no_contesta` / `no_lo_conozco`). No se valida coherencia cruzada entre
`conoceLalo` y `rolLalo`/`opinionLalo`: el contrato dice que siempre se
responden.

```jsonc
{
  "sexo": "hombre|mujer",
  "rangoEdad": "18_30|31_45|46_mas",
  "empresariosConocidos": ["texto libre"],   // 0–3 entradas, 1–80 chars c/u (trim)
  "politicosConocidos": ["texto libre"],     // 1–3 entradas, 1–80 chars c/u (trim)
  "conoceLalo": "si|no",
  "rolLalo": "politico_lider_social|empresario|funcionario_publico|no_sabe_no_contesta",
  "opinionLalo": "muy_buena|buena|regular|mala|muy_mala|no_lo_conozco",
  "preferenciaElectoral": "lalo_ximenez|irineo_molina|fernando_huerta|paola_barrera|ana_gabriela_delgado",
  "preferenciaPartido": "pri|morena|pan|panal_oaxaca|pt|prd_oaxaca|pvem|pto|mc",
  "aprobacionPorGobernante": [
    { "gobernante": "sheinbaum|jara|huerta", "calificacion": "muy_buena|buena|regular|mala|muy_mala" }
  ] // exactamente 3 filas, una por gobernante, sin repetir
}
```

Reglas de las listas de texto libre (`empresariosConocidos`,
`politicosConocidos`): cada entrada se recorta (`trim`), debe quedar de 1 a 80
caracteres; no se validan duplicados (es texto libre). El registro completo
lleva `estado: "completada"` — la rama `noElegible` de v1 desaparece.

## 3. Esquema de datos (migración `20260805*_encuestas_v3`)

Una sola migración SQL que:

1. `TRUNCATE encuestas` — no hay datos que conservar; protege contra filas v1
   en BDs de dev/CI que impedirían los `NOT NULL` nuevos.
2. Elimina las columnas v1 de respuestas: `credencial_vigente`, `rango_edad`
   (se recrea con catálogo nuevo), `genero`, `partido_preferido`,
   `conocimiento_por_persona`, `medios_conocimiento`, `mayor_personalidad`,
   `candidato_preferido`, y la columna `elegibilidad`.
3. Elimina el enum `EncuestaElegibilidad`; recrea `EncuestaEstado` con el único
   valor `completada` (sin `noElegible`).
4. Agrega las columnas v3, todas `NOT NULL` (en v3 todo es obligatorio):
   - `sexo TEXT`, `rango_edad TEXT`, `conoce_lalo TEXT`, `rol_lalo TEXT`,
     `opinion_lalo TEXT`, `preferencia_electoral TEXT`,
     `preferencia_partido TEXT` — catálogos como TEXT validado en la app, no
     enums de Postgres (decisión heredada del módulo: una v4 no debe exigir
     `ALTER TYPE`);
   - `empresarios_conocidos JSONB`, `politicos_conocidos JSONB`,
     `aprobacion_por_gobernante JSONB`.

El resto del modelo `Encuesta` (identidad, fechas, ubicación, dispositivo,
`payloadRaw`/`payloadHash`, índices) no cambia. Sigue siendo **una fila por
encuesta, un solo INSERT atómico**, sin `$transaction`.

## 4. Cambios por archivo (API)

- **`api/src/validators/encuestasIngestValidator.ts`** — `encuestaV3Schema`
  reemplaza a `encuestaV1Schema`. Catálogos nuevos exportados: `SEXOS_V3`,
  `RANGOS_EDAD_V3`, `ROLES_LALO_V3`, `OPINIONES_LALO_V3`,
  `PREFERENCIAS_ELECTORALES_V3`, `PARTIDOS_V3`, `GOBERNANTES_V3`,
  `CALIFICACIONES_V3` (los catálogos v1 se eliminan). Sin unión discriminada de
  estado: `estado: z.literal('completada')`, `versionCuestionario: z.literal(3)`.
  Números/fechas/booleanos estrictos (sin coerce), claves desconocidas se
  estripan — igual que hoy. `aprobacionPorGobernante`: `.length(3)` +
  `superRefine` sin gobernantes repetidos (con guard de forma para no convertir
  un 422 en 500). Se conservan intactos `UUID_RE`, `FOLIO_LOCAL_RE`,
  `TOLERANCIA_DURACION_SEG`, el schema de ubicación y los campos comunes.
- **`api/src/lib/encuestasCanonical.ts`** — `canonicalizarEncuestaV3` /
  `hashEncuestaV3`. `aprobacionPorGobernante` se normaliza al orden fijo de
  `GOBERNANTES_V3` (es un conjunto); las listas de texto libre se hashean **en
  el orden enviado** (no son catálogo cerrado; el teléfono reenvía el mismo
  JSON). Fechas por `toISOString()`, ausentes ≡ null, orden de claves por
  construcción — igual que hoy. `VERSION_CANONICA` sube a **2**: no hay hashes
  viejos con los que chocar tras el TRUNCATE, pero el cambio de esquema queda
  documentado en el hash.
- **`api/src/services/encuestasIngestService.ts`** — `respuestasRow` se aplana
  sin ramas (solo `completada`); los JSONB se guardan con la MISMA
  normalización que entra al hash. El flujo idempotente
  (create → P2002 → findUnique → hash igual 200 / distinto 409) no se toca.
- **`api/src/routes/encuestasIngestRouter.ts`** — `VERSION_SOPORTADA = 3`.
  Nada más.
- **`api/src/services/encuestasRevisionService.ts`** — DTO del listado: fuera
  `elegibilidad`, `partidoPreferido`, `candidatoPreferido`; entran
  `preferenciaElectoral`, `preferenciaPartido`, `conoceLalo`. Selects
  actualizados (siguen excluyendo `payloadRaw`/`payloadHash`). CSV nuevo:

  | Grupo | Columnas |
  |---|---|
  | Identidad | ID remoto, ID local, Folio, Encuestador |
  | Tiempos | Recibido (UTC), Inicio (UTC), Finalización (UTC), Duración (s) |
  | Registro | Estado, Versión cuestionario |
  | Respuestas v3 | Sexo, Rango edad, Empresarios conocidos (join `;`), Políticos conocidos (join `;`), Conoce Lalo, Rol Lalo, Opinión Lalo, Preferencia electoral, Preferencia partido, Aprobación sheinbaum, Aprobación jara, Aprobación huerta (pivoteo del JSONB en el orden de `GOBERNANTES_V3`) |
  | Ubicación | igual que hoy (disponible, lat, lng, precisión, válida, captura, permiso, servicio, motivo) |
  | Dispositivo | Plataforma, Modelo, Versión sistema, Versión app, Dispositivo |

  `csvEscape` (RFC 4180 + neutralización de fórmulas) se aplica a todo; las
  listas de texto libre son texto tecleado por el encuestador y pasan por él
  como el resto. El pivoteo tolera formas anómalas sin reventar (mismo criterio
  que `nivelesPorPersona` hoy). Filtro `estado` del portal queda con el único
  valor `completada`.
- **`api/src/validators/encuestasRevisionValidator.ts`** — ajustar el filtro
  `estado` al enum reducido (si lo referencia).

## 5. Web

- **`web/src/hooks/useEncuestas.ts`** — tipo del DTO actualizado a v3.
- **`web/src/app/revision/encuestas/page.tsx`** — columnas de la tabla:
  Partido/Candidato → Preferencia electoral / Preferencia partido (+ Conoce
  Lalo si cabe); fuera elegibilidad.

## 6. Tests (api/tests/sprint5)

Se reescriben fixtures y suites a v3 conservando la matriz de contrato:

- validator: cada catálogo rechaza valores fuera de rango; límites de las
  listas (0–3 / 1–3, 80 chars, trim); `aprobacionPorGobernante` exige los 3
  gobernantes sin repetir; campos obligatorios ausentes → 422; fechas/duración
  (tolerancia 60 s) y ubicación intactos.
- canonical/hash: hash estable ante reordenamiento de `aprobacionPorGobernante`
  y formatos de fecha equivalentes; sensible al orden de las listas de texto
  libre; campos de la cola del teléfono no afectan.
- ingest service/HTTP: 201 alta, 200 reenvío idéntico (mismo `idRemoto`), 409
  contenido distinto, 422 con `issues`, `versionCuestionario: 1` → 422
  `UNSUPPORTED_VERSION`, 401, 429, ping, 405.
- export/revisión: DTO y CSV con los campos v3; pivoteo de aprobaciones;
  neutralización de fórmulas en texto libre.

CI: los mismos gates de siempre (`test:sprint5`, `tsc --noEmit`,
`prisma validate`, build, y `test:migrations` debe pasar con la migración
nueva).

## 7. Docs

- `docs/encuestas-okrean.md` y `docs/encuestas-okrean-openapi.yaml` se
  actualizan al contrato v3 (esquema de respuestas, ejemplo de payload, nota de
  que v1 ya no se acepta).

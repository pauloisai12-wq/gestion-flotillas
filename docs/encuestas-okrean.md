# Encuestas Okrean — ingesta móvil + pestaña de revisión

Módulo aditivo que recibe **encuestas de campo** desde la app móvil **Encuestas Okrean** y las
publica en una pestaña nueva del portal de revisión.

**No tiene nada que ver con GeoCampo / `qa_externa`.** Son dos apps distintas, de dos equipos
distintos, con tablas, API keys y CLI de alta propios: una key de GeoCampo **no** sirve aquí y una
key de Encuestas Okrean **no** sirve allá. Lo único que comparten es la puerta de entrada
(`https://qa.aztechcomposites.com`) y la **cuenta del revisor**: el mismo usuario `REVISOR_QA` ve
las dos secciones del portal, pero los **datos están separados** —tablas distintas, exportaciones
distintas— y ninguna consulta cruza de un módulo al otro.

| | GeoCampo (`qa_externa`) | Encuestas Okrean |
|---|---|---|
| Rutas de ingesta | `/api/qa-externa/*` | `/api/v1/encuestas` |
| Tablas | `qa_externa_registros`, `qa_externa_personas`, `qa_externa_dispositivos` | `encuestas`, `encuestas_dispositivos` |
| API keys | `qa:device:register` | `encuestas:device:register` |
| Pestañas del portal | Evidencias de campo · Registro de personas | Encuestas |
| Cuenta del revisor | La misma (`REVISOR_QA`) | La misma (`REVISOR_QA`) |

---

## Configuración de la app móvil

Esto es lo único que el equipo móvil necesita para empezar:

| Ajuste | Valor |
|---|---|
| **URL BASE** | `https://qa.aztechcomposites.com/api` |
| **Ruta de envío** | `/v1/encuestas` → URL completa `https://qa.aztechcomposites.com/api/v1/encuestas` |
| **Método** | `POST` |
| **Header** | `Content-Type: application/json` |
| **Header** | `Authorization: Bearer <api key del dispositivo>` |
| **Prueba de conexión** | `GET https://qa.aztechcomposites.com/api/v1/encuestas/ping` → `{"ok":true}` |
| **Tope del cuerpo** | 256 KB |

### Por qué la URL base lleva `/api` (y no se puede quitar)

No es una convención de estilo: es la única ruta por la que el tráfico llega al backend en el
despliegue público. La cadena es:

1. Caddy termina el TLS de `qa.aztechcomposites.com` y manda **todo** a Next
   (`Caddyfile.public:19,37` → `reverse_proxy web:3000`). La API no está publicada al exterior.
2. Next reescribe hacia la API **solo** las rutas que empiezan por `/api`, conservando el prefijo:
   `/api/:path*` → `http://api:3001/api/:path*` (`web/next.config.ts:29-33`).
3. Cualquier ruta que **no** empiece por `/api` la evalúa el proxy de sesión de Next, que sin
   cookie redirige a `/login` (`web/src/proxy.ts:27-32`; el matcher excluye `api` justamente para
   dejar pasar el tráfico de backend, `web/src/proxy.ts:41`).

Es decir: `POST https://qa.aztechcomposites.com/v1/encuestas` **no** llega a la API — devuelve un
`307` al login del portal, que la app leerá como un error raro. Si el equipo móvil ve HTML donde
esperaba JSON, casi siempre falta el `/api`.

---

## Endpoints

### Cara de DISPOSITIVO (API key, sin sesión)

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| POST | `/api/v1/encuestas` | `Authorization: Bearer <api key>` | `201 {"idRemoto":"<uuid>"}` (alta) · `200 {"idRemoto":"<uuid>"}` (reenvío idempotente) |
| GET | `/api/v1/encuestas/ping` | Bearer | `200 {"ok":true}` (sin key o key mala → `401`) |
| GET | `/api/v1/encuestas` | Bearer | `405` **tras autenticar** — red de seguridad para una app que equivoque el método |

> El `405` de `GET /api/v1/encuestas` existe por el mismo motivo que en GeoCampo
> (`api/src/routes/qaExternaRouter.ts:193-200`): sin él la petición sale del router y la atrapan los
> montajes comodín `app.use('/api', authMiddleware, …)` (`api/src/index.ts:269,274`), cuyo
> `authMiddleware` de JWT responde **401** — y el móvil lee ese 401 como "API key inválida" y
> dispara una reconfiguración innecesaria. El 405 dice lo que de verdad pasa: la key sirve, el
> método no.

### Cara de REVISOR (JWT por cookie, rol `REVISOR_QA` exclusivo)

Vive **fuera** de `/api/v1/*`, que es el montaje por API key:

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/encuestas` | `200 { "data": [ <EncuestaDto> ], "pagination": { "page","limit","total","totalPages" } }` |
| GET / HEAD | `/api/encuestas/export.csv` | `200 text/csv; charset=utf-8` como adjunto. `HEAD` solo valida filtros y cabeceras (no toca la base de datos) |

Parámetros de consulta:

| Parámetro | Listado | Exportación | Notas |
|---|---|---|---|
| `page` / `limit` | opcional | — | Default 20, tope 100 |
| `dispositivo` | opcional | opcional | Texto: coincide contra el `identificador` del dispositivo registrado |
| `dateFrom` / `dateTo` | opcional | **obligatorios** | `AAAA-MM-DD` sobre `fechaHoraFinalizacion`. Día civil completo en **UTC** con **tope superior exclusivo** (`dateTo` + 1 día). En exportación: `dateTo ≥ dateFrom` y rango máximo **366 días** |

Cada elemento de `data` (`EncuestaDto`): `id`, `idRemoto`, `folioLocal`, `encuestador`,
`versionCuestionario`, `preferenciaElectoral`, `preferenciaPartido`, `conoceLalo`,
`duracionSegundos`, `fechaHoraFinalizacion`, `recibidoEn`, `ubicacionDisponible` y
`dispositivo: { id, identificador }`.
El listado **no expone** `payloadRaw`, `payloadHash`, las coordenadas ni los JSON de respuestas: la
pantalla es un índice, el detalle fino sale por el CSV.

Parámetros inválidos → `400 {"error":"Parámetros inválidos","code":"BAD_REQUEST","details":[{"field","message"}]}`.
Sin sesión → `401`; con sesión de otro rol → `403`.

El contrato de la cara de dispositivo está además en formato máquina:
**`docs/encuestas-okrean-openapi.yaml`** (OpenAPI 3.1). Se mantiene a mano porque el generador
runtime (`/api/docs`) está apagado en producción (`api/src/index.ts:224-226`).

---

## Contrato v3 del payload

⚠️ **El servidor solo acepta `versionCuestionario: 3`.** Un registro v1 o v2 recibe `422 UNSUPPORTED_VERSION` y
la app debe actualizarse. No hay retrocompatibilidad con cuestionarios anteriores.

Un solo `Content-Type`: `application/json`. Al ser JSON (y no multipart), **los números viajan como
números**: `"duracionSegundos": "397"` es un `422`, no un 397.

### Campos comunes a las dos ramas

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `idLocal` | string UUID | sí | **Clave de idempotencia** (UNIQUE global, no por dispositivo). Estable entre reintentos, jamás reutilizado |
| `folioLocal` | string | **no** | Folio de papel. Formato `LX-<dígitos>`. **No es único**: dos teléfonos pueden emitir el mismo folio y los dos se aceptan |
| `encuestador` | string | **no** | Nombre de quien levanta la encuesta. Texto no vacío, máx. 120 caracteres (se recorta el espacio sobrante). Va en la **raíz**, no dentro de `respuestas`. **Entra al hash canónico** |
| `versionCuestionario` | entero | sí | Solo `3`. Otro entero → `422 UNSUPPORTED_VERSION`; algo que no sea entero positivo → `422 VALIDATION_ERROR` |
| `estado` | `completada` | sí | Siempre `completada`. El servidor rechaza cualquier otro valor |
| `fechaHoraInicio` | string ISO-8601 **con `Z`** | sí | |
| `fechaHoraFinalizacion` | string ISO-8601 **con `Z`** | sí | Debe ser ≥ `fechaHoraInicio` |
| `duracionSegundos` | entero ≥ 0 | sí | Se contrasta con el intervalo; ver *tolerancia* abajo |
| `respuestas` | objeto | sí | **Las respuestas del cuestionario van anidadas aquí, no en la raíz.** Todos los campos obligatorios |
| `ubicacion` | objeto | **no** | Bloque completo o ausente. **`null` no se acepta**; ver *Ubicación* |
| `dispositivo` | objeto | sí | `{ plataforma, modelo, versionSistema }` — texto no vacío, máx. 120 caracteres cada uno |
| `versionAplicacion` | string | sí | Versión de la app (máx. 60 caracteres). Entra al hash canónico |

> ⚠️ **Las respuestas no viven en la raíz del payload.** Van dentro del objeto `respuestas`
> (`"respuestas": { "sexo": "mujer", "rangoEdad": "31_45", … }`). Mandarlas sueltas en la raíz es `422`: el
> schema exige `respuestas` y descarta lo que sobra.

> ⚠️ **`encuestador`: si no se conoce, se OMITE la clave — no se manda `null`.** El campo es
> opcional (`.optional()`, no `.nullable()`) para que las encuestas ya capturadas en los teléfonos
> antes de actualizar la app se sigan aceptando, exactamente igual que el bloque `ubicacion`. Un
> `"encuestador": null` es `422`, y un `""` también.
>
> Además **entra al hash de idempotencia**, así que hay que capturarlo **con el registro** y no
> estamparlo en el momento de enviar: si el valor cambiara entre el primer envío y el reintento, el
> segundo daría `409` en vez de `200`. Es el mismo cuidado que ya piden `dispositivo{…}` y
> `versionAplicacion`.

> ⚠️ **Manda siempre el sufijo `Z` en las fechas.** La validación es `Date.parse`, y una cadena ISO
> de fecha **y hora** sin designador de zona la interpreta el estándar en la hora local del proceso.
> Hoy es inocuo (ningún compose define `TZ` y los contenedores corren en UTC), pero basta con que
> alguien añada `TZ=America/Mexico_City` para que la misma cadena se desplace 6 horas — y con ella
> el día civil por el que filtra el revisor. Es el mismo aviso que aplica a GeoCampo
> (`docs/qa-externa.md`).

> **Tolerancia de duración: ±60 s** (`TOLERANCIA_DURACION_SEG`). Se exige
> `|duracionSegundos − (fechaHoraFinalizacion − fechaHoraInicio)/1000| ≤ 60`. Fuera de esa ventana
> es `422`. Si el cronómetro de la app **pausa** cuando la pantalla se apaga, esta regla producirá
> falsos rechazos y hay que relajarla a `duracion ≤ intervalo + 60` — es un punto abierto a
> confirmar con el equipo móvil.

### Contenido de `respuestas` (v3)

Todos los campos son **obligatorios**. No hay saltos de lógica: `rolLalo` y `opinionLalo` se contestan
siempre (sus catálogos ya incluyen `no_sabe_no_contesta` / `no_lo_conozco`). No se valida coherencia
cruzada: el contrato dice que siempre se responden.

| Campo | Tipo | Notas |
|---|---|---|
| `sexo` | catálogo | `hombre` \| `mujer` |
| `rangoEdad` | catálogo | `18_30` \| `31_45` \| `46_mas` |
| `empresariosConocidos` | array de strings | 0–3 entradas, 1–80 caracteres cada una (se recorta espacio sobrante). Texto libre, sin duplicados validados |
| `politicosConocidos` | array de strings | 1–3 entradas, 1–80 caracteres cada una. Texto libre |
| `conoceLalo` | `si` \| `no` | |
| `rolLalo` | catálogo | `politico_lider_social` \| `empresario` \| `funcionario_publico` \| `no_sabe_no_contesta` |
| `opinionLalo` | catálogo | `muy_buena` \| `buena` \| `regular` \| `mala` \| `muy_mala` \| `no_lo_conozco` |
| `preferenciaElectoral` | catálogo | `lalo_ximenez` \| `irineo_molina` \| `fernando_huerta` \| `paola_barrera` \| `ana_gabriela_delgado` |
| `preferenciaPartido` | catálogo | `pri` \| `morena` \| `pan` \| `panal_oaxaca` \| `pt` \| `prd_oaxaca` \| `pvem` \| `pto` \| `mc` |
| `aprobacionPorGobernante` | array de `{gobernante, calificacion}` | **Exactamente 3 filas, una por gobernante, sin repetir.** Orden: `sheinbaum`, `jara`, `huerta`. Calificaciones: `muy_buena` \| `buena` \| `regular` \| `mala` \| `muy_mala` |

Son **texto validado en la aplicación**, no enums de PostgreSQL: así se puede publicar un cuestionario v4
sin `ALTER TYPE`. Un valor fuera del catálogo es `422`, nunca un guardado silencioso.

| Catálogo | Valores |
|---|---|
| **Sexo** | `hombre`, `mujer` |
| **Rango de edad** | `18_30`, `31_45`, `46_mas` |
| **Rol de Lalo** | `politico_lider_social`, `empresario`, `funcionario_publico`, `no_sabe_no_contesta` |
| **Opinión de Lalo** | `muy_buena`, `buena`, `regular`, `mala`, `muy_mala`, `no_lo_conozco` |
| **Preferencia electoral** | `lalo_ximenez`, `irineo_molina`, `fernando_huerta`, `paola_barrera`, `ana_gabriela_delgado` |
| **Partido** | `pri`, `morena`, `pan`, `panal_oaxaca`, `pt`, `prd_oaxaca`, `pvem`, `pto`, `mc` |
| **Gobernantes (aprobación)** | `sheinbaum`, `jara`, `huerta` (orden canónico para pivoteo del CSV) |
| **Calificación de gobernantes** | `muy_buena`, `buena`, `regular`, `mala`, `muy_mala` |
| **Estado del registro** | `completada` (único valor aceptado) |

### Ubicación

El bloque `ubicacion` es una **unión discriminada por `disponible`**, y sus tres estados no son dos:

| Estado | Qué significa | Cómo se persiste |
|---|---|---|
| Bloque **ausente** | El payload es de una versión de la app anterior a la captura de GPS | `ubicacion_disponible = NULL` |
| `disponible: true` | Hay coordenadas | `ubicacion_disponible = true` + coordenadas |
| `disponible: false` | La app intentó y no pudo | `ubicacion_disponible = false`, coordenadas en `NULL` |

**`NULL` no es `false`.** Un `NULL` dice "esta app ni lo intentaba"; un `false` dice "lo intentó y
falló, y aquí está el motivo". Por eso `"ubicacion": null` **se rechaza**: si la app no tiene el
dato, omite la clave entera; si lo intentó y falló, manda la rama `false` con su motivo.

**Rama `disponible: true`** — todos obligatorios:

| Campo | Regla |
|---|---|
| `latitud` | −90 … 90 |
| `longitud` | −180 … 180 |
| `precisionMetros` | número **finito** ≥ 0. `Infinity`/`NaN` se rechazan explícitamente |
| `fechaHoraCaptura` | ISO-8601 con `Z` |
| `permiso` | solo `concedido` |
| `servicioActivo` | solo `true` |
| `esValida` | **debe ser exactamente `precisionMetros <= 50`** |

> `esValida` es redundante **a propósito**: la app ya la calcula y el servidor la recalcula. Si no
> coinciden, la encuesta se rechaza con `422` en vez de guardarse — un desacuerdo ahí significa que
> el umbral de calidad del cliente y el del servidor divergieron, y ese es exactamente el dato que
> el análisis no debe heredar en silencio.

**Rama `disponible: false`** — `permiso` (`concedido` \| `denegado` \| `noSolicitado`),
`servicioActivo` (booleano) y `motivoNoDisponible` obligatorios, con coherencia exigida:

| `motivoNoDisponible` | Coherencia |
|---|---|
| `permisoDenegado` | `permiso` **no** puede ser `concedido` |
| `servicioDesactivado` | `servicioActivo` debe ser `false` |
| `errorTemporal` / `omitidaPorEncuestador` | son los únicos motivos válidos cuando el permiso está concedido **y** el servicio activo |

> Esta matriz es una interpretación razonable del comportamiento de la app, **no un contrato
> cerrado con el equipo móvil**. Un `422` aquí es terminal para ese registro en el teléfono, así que
> conviene validarla contra la lógica real antes de congelarla.

### Campos que el servidor ignora

Estos llegan en el body de la app y el servidor los **descarta** (no se validan, no entran al hash,
no ocupan columna). Mandarlos es inofensivo; **no** mandarlos también:

`estadoSincronizacion`, `numeroIntentosSincronizacion`, `fechaUltimoIntento`, `fechaSincronizacion`
y un `idRemoto` generado por el cliente.

Que estén excluidos del hash es lo que hace que un reintento **después** de que el teléfono
incremente su contador de intentos siga siendo el mismo registro (`200`) y no un conflicto (`409`).
El body crudo se conserva íntegro en `payload_raw` para auditoría.

---

## Códigos de respuesta

| Código | Cuerpo | Cuándo | ¿Reintentar? |
|---|---|---|---|
| `201` | `{"idRemoto":"<uuid>"}` | Encuesta creada (primer envío) | — |
| `200` | `{"idRemoto":"<uuid>"}` | Reenvío idempotente: mismo `idLocal`, mismo contenido. **Mismo `idRemoto` que el 201 original** | — |
| `400` | `{"error":…,"code":"BAD_JSON",…}` | El cuerpo no es JSON válido, o no es un objeto | No, sin corregir |
| `401` | `{"error":…,"code":"UNAUTHORIZED"}` | Sin `Authorization`, formato distinto de `Bearer <key>`, key desconocida o dispositivo revocado (`activo=false`) | No: reconfigurar la key |
| `403` | `{"error":"Sin permisos","code":"FORBIDDEN"}` | **La ingesta no lo emite.** Recibirlo significa que la petición no llegó a este router — típicamente URL base mal armada que cayó en un montaje protegido por JWT | No: corregir la URL |
| `409` | `{"error":…,"code":"CONFLICT",…}` | El mismo `idLocal` ya está registrado **con contenido sustantivo distinto**. La fila original no se toca | No: es un `idLocal` reutilizado |
| `413` | `{"error":…,"code":"PAYLOAD_TOO_LARGE",…}` | El cuerpo supera **256 KB** | No, sin recortar |
| `422` | `{"error":"Datos inválidos","code":"VALIDATION_ERROR","issues":[{"field","message"}],…}` | El JSON es válido pero no pasa el cuestionario v3 | No: terminal |
| `422` | `{"error":…,"code":"UNSUPPORTED_VERSION",…}` | `versionCuestionario` entero distinto de 3 | No: hay que actualizar la app |
| `429` | `{"error":…,"code":"RATE_LIMITED"}` + `Retry-After` | Cuota agotada (por dispositivo o por IP) | Sí, con backoff |
| `5xx` | `{"error":…,"code":"INTERNAL_ERROR",…}` | Error del servidor. **Sin escritura parcial**: el alta es un solo INSERT atómico | Sí, con el mismo `idLocal` |

**Forma del error.** Todos los errores comparten la misma envoltura:

```json
{ "error": "<mensaje legible>", "code": "<CÓDIGO_ESTABLE>", "requestId": "<uuid>" }
```

más `issues: [{ "field", "message" }]` en los `422` de validación, o `details` en algunos `400`. El
`requestId` correlaciona la respuesta con la línea del log del servidor: inclúyelo al reportar una
incidencia.

> **En éxito la app solo necesita `idRemoto`.** Todo lo demás del cuerpo es informativo.
>
> **Nunca se responde `204`.** Un `204` no lleva cuerpo, y sin cuerpo no hay `idRemoto` con el que
> cerrar el registro local. Si la app recibe un 204, no viene de este endpoint.

> **`400` y `422` no son intercambiables.** El `400` es "no pude leer tu JSON"; el `422` es "leí tu
> JSON y el contenido no cumple el cuestionario". La app puede tratarlos igual (los dos son
> terminales), pero el operador los distingue en el log.

---

## Idempotencia

Dos mecanismos, uno encima del otro:

1. **`idLocal` es UNIQUE** en la tabla `encuestas`. Es una restricción de base de datos, no una
   comprobación previa: bajo concurrencia, PostgreSQL deja pasar exactamente un `INSERT`.
2. **Hash canónico SHA-256** del contenido sustantivo (`payload_hash`), que decide si el segundo
   envío es "el mismo registro" o "otro registro con la misma clave".

**Qué entra al hash:** todo lo sustantivo, incluidos `encuestador`, `dispositivo{…}` y
`versionAplicacion`.
**Qué queda fuera:** el `idRemoto` que mande el cliente y los cuatro campos de sincronización
(`estadoSincronizacion`, `numeroIntentosSincronizacion`, `fechaUltimoIntento`,
`fechaSincronizacion`).

Antes de hashear se **normaliza**, para que reenvíos equivalentes den el mismo hash:

- fechas a ISO-8601 UTC (`2026-07-30T16:18:41Z`, `…+00:00` y `…16:18:41.000Z` son la misma);
- `folioLocal` ausente ≡ `null`;
- `encuestador` ausente ≡ `null`;
- `ubicacion` ausente ≡ `null`;
- `aprobacionPorGobernante` reordenado al orden canónico de `GOBERNANTES_V3` (es un conjunto, el orden no es información);
- las listas de texto libre (`empresariosConocidos`, `politicosConocidos`) se hashean **en el orden enviado** (son datos libres que el teléfono devuelve igual);
- orden de claves fijo por construcción, así que no depende de cómo llegó el body.

La forma canónica lleva un campo `v` con la versión del **algoritmo** de canonicalización (no la del
cuestionario): si alguna de estas reglas cambia, subirlo evita comparar hashes viejos contra nuevos
como si fueran del mismo esquema (`api/src/lib/encuestasCanonical.ts`). Sube a `2` en v3: el schema v3
es completamente nuevo y no hay hashes v1 en producción con los que pudiera chocar.

**El flujo:**

```
INSERT
 ├─ éxito ───────────────────► 201 {idRemoto}          (fila nueva)
 └─ choque de UNIQUE (idLocal)
     └─ releer la fila existente
         ├─ mismo payload_hash ──► 200 {idRemoto}      (el MISMO de la primera vez)
         └─ hash distinto ───────► 409 CONFLICT        (la fila original NO se toca)
```

No hay transacción ni `UPDATE`: **una encuesta terminada es inmutable**. A diferencia del registro
de personas de GeoCampo (que es last-write-wins), aquí un segundo envío nunca sobrescribe. Reintentar
tras un timeout o un `5xx` es seguro y no duplica.

> `dispositivo{…}` y `versionAplicacion` **entran** al hash. Si la app los estampa en el momento de
> *enviar* en vez de en el de *capturar*, un reintento hecho después de actualizar la app daría
> `409`. Punto a confirmar con el equipo móvil; si es el caso, hay que excluirlos del hash.

---

## Rate limit: dos cubos

| Cubo | Clave en Redis | Alcance | Cuota | Qué protege |
|---|---|---|---|---|
| Por IP (pre-auth) | `rl:enc:ip:<ip>` | Todo `/api/v1/encuestas*` | `ENCUESTAS_IP_RATE_MAX` (**120**) | Sondeo de API keys |
| Por dispositivo | `rl:enc:dev:<dispositivo_id>` | Solo `POST /api/v1/encuestas` | `ENCUESTAS_RATE_MAX` (**60**) | Cuota de captura |

Los dos comparten ventana: `ENCUESTAS_RATE_WINDOW_SEC` (**60 s**). El de IP corre **antes** de
autenticar —no puede saber de qué dispositivo se trata— y por eso lleva el doble de cuota: un solo
teléfono que vacía su cola al recuperar señal no debe agotar el presupuesto de la puerta de entrada.

Su clave lleva prefijo propio (`enc:ip:`) en vez del `ip:` genérico: ese cubo por defecto lo comparte
`publicRouter` con cuota 10, y sin prefijo el tráfico de la app consumiría el del portal público
(y viceversa). Por el mismo motivo no comparte prefijo con GeoCampo (`qae:ip:`): **las cuotas de los
dos módulos son independientes**.

Todo `429` llega con cabecera `Retry-After` en segundos (`api/src/middlewares/rateLimit.ts:54`).

---

## Ejemplos

Los tres van contra el despliegue público real. Sustituye `<API KEY>` por la key del dispositivo.

### 1. Encuesta completada → `201`

```bash
curl -sS -i -X POST https://qa.aztechcomposites.com/api/v1/encuestas \
  -H 'Authorization: Bearer <API KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
  "idLocal": "7f9c2a10-4d3b-4a7e-9f21-0c8b5d6e1a44",
  "folioLocal": "LX-001248",
  "encuestador": "María López",
  "versionCuestionario": 3,
  "estado": "completada",
  "fechaHoraInicio": "2026-07-30T16:12:04.000Z",
  "fechaHoraFinalizacion": "2026-07-30T16:18:41.000Z",
  "duracionSegundos": 397,
  "respuestas": {
    "sexo": "mujer",
    "rangoEdad": "31_45",
    "empresariosConocidos": ["Javier González", "Rosa Mendoza"],
    "politicosConocidos": ["Lalo Ximénez", "Irineo Molina", "Fernando Huerta"],
    "conoceLalo": "si",
    "rolLalo": "politico_lider_social",
    "opinionLalo": "buena",
    "preferenciaElectoral": "lalo_ximenez",
    "preferenciaPartido": "morena",
    "aprobacionPorGobernante": [
      {"gobernante": "sheinbaum", "calificacion": "muy_buena"},
      {"gobernante": "jara", "calificacion": "buena"},
      {"gobernante": "huerta", "calificacion": "buena"}
    ]
  },
  "ubicacion": {
    "disponible": true,
    "latitud": 19.432608,
    "longitud": -99.133209,
    "precisionMetros": 12.4,
    "fechaHoraCaptura": "2026-07-30T16:18:39.000Z",
    "permiso": "concedido",
    "servicioActivo": true,
    "esValida": true
  },
  "dispositivo": {"plataforma": "android", "modelo": "Moto G54", "versionSistema": "14"},
  "versionAplicacion": "2.0.0"
}'
```

```
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{"idRemoto":"c1a7e0b2-9d44-4f0a-b7c3-2e5f8a91d033"}
```

### 2. Reenvío idéntico → `200` con el MISMO `idRemoto`

Exactamente el mismo comando de arriba, otra vez (es lo que hace la app al reintentar tras un
timeout). Puedes cambiar los campos de sincronización o el `idRemoto` del cliente: no alteran el
hash.

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"idRemoto":"c1a7e0b2-9d44-4f0a-b7c3-2e5f8a91d033"}
```

Si en cambio cambias un campo **sustantivo** (por ejemplo `respuestas.preferenciaPartido`) manteniendo
el `idLocal`, la respuesta es `409` y la fila original queda intacta.


### Prueba de conexión

```bash
curl -sS https://qa.aztechcomposites.com/api/v1/encuestas/ping -H 'Authorization: Bearer <API KEY>'
# {"ok":true}
```

---

## Alta y revocación de un dispositivo (operador)

Cada teléfono lleva su propia API key. Se emiten en el servidor, con el stack ya levantado:

```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.public.yml"
$COMPOSE run --rm --no-deps -e DEVICE_NAME="encuestador-01" api npm run encuestas:device:register
```

> El `--no-deps` no es opcional en el perfil público: sin él, `docker compose run` intenta
> levantar la cadena de dependencias y `storage-init` aborta con exit 78 (guard
> `FLOTILLAS_PREDEPLOY_GUARD`, `docker-compose.public.yml:40-43`, que exige pasar por
> `./deploy-public.sh` con backup previo). Con `--no-deps` el CLI solo se conecta a la red del
> stack ya levantado.

> ⚠️ **La API key se imprime UNA SOLA VEZ.** El servidor guarda únicamente su hash SHA-256
> (`api/src/lib/encuestasKeyHash.ts`), así que no hay forma de recuperarla después: si se pierde, se
> revoca el dispositivo y se da de alta otro. Cópiala en el momento y configúrala en la app como
> `Authorization: Bearer <API KEY>`.

En staging interno (VPN) el atajo de compose es el de `CLAUDE.md §5`:

```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.staging.yml"
```

Revocar (el dispositivo queda `activo=false` y su key responde `401`, sin borrar las encuestas ya
recibidas):

```bash
$COMPOSE run --rm --no-deps -e DEVICE_ID=3 api npm run encuestas:device:revoke
# o por nombre:
$COMPOSE run --rm --no-deps -e DEVICE_NAME="encuestador-01" api npm run encuestas:device:revoke
```

Estos dispositivos son **propios de Encuestas Okrean**: viven en `encuestas_dispositivos`, y una key
de GeoCampo (`qa_externa_dispositivos`) no autentica aquí ni al revés.

(Opcional) Para hashear las keys con HMAC en lugar de SHA-256 plano, define `ENCUESTAS_KEY_PEPPER` en
el `.env` de la API **y** pásalo también al CLI de alta (`-e ENCUESTAS_KEY_PEPPER=...`): si el CLI
hashea con un pepper distinto del que usa la API, la key emitida no autenticará nunca.

---

## ⚠️ Nota TLS para el equipo móvil

| Despliegue | URL base | Certificado | Expo Go |
|---|---|---|---|
| **Público (QA)** — el que usa esta app | `https://qa.aztechcomposites.com` | **Let's Encrypt** (CA pública): `Caddyfile.public:16,19` declara el contacto ACME y el dominio real; `docker-compose.public.yml:217-218` publica `:80` (reto HTTP-01) y `:443`, y el volumen `caddy_data` persiste el certificado | ✅ **Funciona sin `network-security-config`** ni CA instalada |
| **Staging interno (VPN)** | `https://flotillas.internal:8443` | `tls internal`: CA propia de Caddy, autofirmada | ❌ Android lo rechaza en Expo Go; requiere build EAS con la CA confiada |

Contra el despliegue público —el previsto para Encuestas Okrean— **basta Expo Go**: no hace falta CA
custom, ni pinning, ni configuración de red especial. El detalle de exportar la CA para el caso de
staging está en `docs/qa-externa.md`.

---

## Descarga del revisor (CSV)

`GET /api/encuestas/export.csv` se sirve en **streaming por lotes**, con **BOM UTF-8** (para que
Excel en Windows no rompa los acentos) y saltos `CRLF`. Nombre del archivo:
`encuestas-<dateFrom>_<dateTo>.csv`.

**36 columnas** (v3), en este orden exacto (el rótulo y el orden los fija `ENCUESTAS_CSV_HEADERS` en
`api/src/services/encuestasRevisionService.ts`):

| Bloque | Columnas |
|---|---|
| Identidad | ID remoto · ID local · Folio · Encuestador (vacío si el teléfono no lo mandó) |
| Tiempos | Recibido (UTC) · Inicio (UTC) · Finalización (UTC) · Duración (s) |
| Registro | Estado · Versión cuestionario |
| Respuestas v3 | Sexo · Rango edad · Empresarios conocidos (join `;`) · Políticos conocidos (join `;`) · Conoce Lalo · Rol Lalo · Opinión Lalo · Preferencia electoral · Preferencia partido · Aprobación sheinbaum · Aprobación jara · Aprobación huerta |
| Ubicación | Disponible · Latitud · Longitud · Precisión (m) · Válida · Capturada (UTC) · Permiso · Servicio activo · Motivo sin ubicación |
| Dispositivo | Plataforma · Modelo · Versión del sistema · Versión app · Dispositivo (identificador de la API key) |

Las fechas salen en **ISO UTC** (igual que se persisten: la hora local del revisor no debe cambiar
el contenido del archivo) y los booleanos como `si` / `no` / celda vacía.

**`payload_raw` y `payload_hash` no se exportan nunca**, ni salen en el listado: son auditoría
interna.

Las celdas de **texto** que empiezan por `=`, `+`, `-`, `@`, TAB o CR salen precedidas de un
apóstrofo — la marca de "esto es texto" de Excel. No es cosmética: el modelo del teléfono, el folio,
el encuestador y la versión de la app son **texto libre que manda el dispositivo**, y una celda
`=HYPERLINK(...)` se ejecutaría en la máquina del revisor al abrir el archivo. Las columnas
numéricas quedan exentas para no romper latitud/longitud/precisión.

**Tope duro de 50 000 filas** por descarga: si el filtro da más, el CSV se corta ahí y **aun así
responde `200`**. Como el orden de exportación es por `id` ascendente (el cursor que permite leer por
lotes sin `OFFSET`), lo que se pierde son las encuestas **más recientes**. Quien automatice la
descarga debe comparar las filas obtenidas contra el `total` del listado. Mismo comportamiento y
mismo motivo que en el CSV de personas (`docs/qa-externa.md`).

Un fallo de base de datos **antes** del primer lote sale como `500` honesto; a media descarga ya no
hay arreglo dentro de HTTP/1.1 (el `200` y las cabeceras viajaron con el primer byte): se registra en
el log y el archivo se cierra truncado.

---

## Diccionario de datos

### Tabla `encuestas`

| Columna | Tipo | Origen | Semántica |
|---|---|---|---|
| `id` | `integer` PK | servidor | Clave interna y **cursor de la exportación** (orden de llegada) |
| `id_remoto` | `text` UNIQUE | **servidor** | UUID que se devuelve a la app. Estable para un mismo `id_local` |
| `id_local` | `text` UNIQUE | cliente (validado) | UUID del teléfono. **La restricción de idempotencia** |
| `dispositivo_id` | `integer` FK → `encuestas_dispositivos` | **servidor** | Estampado desde la API key autenticada. El cliente nunca lo manda (FK `RESTRICT`: no se borra un dispositivo con encuestas) |
| `payload_hash` | `text` | servidor | SHA-256 canónico del contenido sustantivo. **No exportable** |
| `version_cuestionario` | `integer` | cliente (validado) | Hoy siempre `3` |
| `folio_local` | `text` NULL | cliente (validado) | Folio de papel `LX-<dígitos>`. **No único** |
| `encuestador` | `text` NULL | cliente (validado) | Nombre de quien levanta la encuesta (máx. 120). **Opcional**: `NULL` si la app no lo mandó. **Texto libre** — el CSV lo neutraliza contra fórmulas. Entra al hash |
| `estado` | enum `EncuestaEstado` | cliente (validado) | Siempre `completada` en v3 |
| `fecha_hora_inicio` | `timestamp` | cliente (validado) | Inicio de la entrevista, según el reloj del teléfono |
| `fecha_hora_finalizacion` | `timestamp` | cliente (validado) | Fin de la entrevista. **Es el campo por el que filtra el revisor** |
| `duracion_segundos` | `integer` | cliente (validado) | Cronómetro de la app, contrastado con el intervalo (±60 s) |
| `sexo` | `text` | cliente (validado) | `hombre` \| `mujer` |
| `rango_edad` | `text` | cliente (validado) | `18_30` \| `31_45` \| `46_mas` |
| `empresarios_conocidos` | `jsonb` | cliente (validado) | Lista de nombres (0–3), en orden enviado |
| `politicos_conocidos` | `jsonb` | cliente (validado) | Lista de nombres (1–3), en orden enviado |
| `conoce_lalo` | `text` | cliente (validado) | `si` \| `no` |
| `rol_lalo` | `text` | cliente (validado) | Catálogo v3 |
| `opinion_lalo` | `text` | cliente (validado) | Catálogo v3 |
| `preferencia_electoral` | `text` | cliente (validado) | Catálogo v3 |
| `preferencia_partido` | `text` | cliente (validado) | Catálogo v3 |
| `aprobacion_por_gobernante` | `jsonb` | cliente (validado) | `[{gobernante,calificacion}]` ×3, en orden canónico |
| `ubicacion_disponible` | `boolean` NULL | cliente (validado) | **`NULL` = el payload no traía bloque de ubicación** (app antigua); distinto de `false` = lo intentó y falló |
| `ubicacion_lat` | `double` NULL | cliente (validado) | Solo con `disponible = true` |
| `ubicacion_lng` | `double` NULL | cliente (validado) | Solo con `disponible = true` |
| `ubicacion_precision_m` | `double` NULL | cliente (validado) | Radio de incertidumbre en metros (finito, ≥ 0) |
| `ubicacion_capturada_at` | `timestamp` NULL | cliente (validado) | Instante de la lectura del GPS, de `ubicacion.fechaHoraCaptura` |
| `ubicacion_es_valida` | `boolean` NULL | cliente (validado) | Equivale a `precision ≤ 50 m`; el servidor verifica la coherencia |
| `ubicacion_permiso` | `text` NULL | cliente (validado) | Estado del permiso del sistema: `concedido` \| `denegado` \| `noSolicitado` |
| `ubicacion_servicio_activo` | `boolean` NULL | cliente (validado) | Si el servicio de ubicación estaba encendido |
| `ubicacion_motivo_no_disponible` | `text` NULL | cliente (validado) | Solo con `disponible = false` |
| `dispositivo_plataforma` | `text` | cliente (validado) | `dispositivo.plataforma` del payload |
| `dispositivo_modelo` | `text` | cliente (validado) | `dispositivo.modelo`. **Texto libre** — por eso el CSV lo neutraliza contra fórmulas |
| `dispositivo_version_sistema` | `text` | cliente (validado) | `dispositivo.versionSistema` |
| `version_aplicacion` | `text` | cliente (validado) | Versión de la app. Entra al hash |
| `payload_raw` | `text` NULL | servidor (copia del body) | Body crudo tal como llegó, con los campos de sincronización. **Solo auditoría: NUNCA sale en DTO ni en CSV** |
| `recibido_en` | `timestamp` | **servidor** | Estampa de llegada, independiente del reloj del teléfono |
| `created_at` / `updated_at` | `timestamp` | servidor | Auditoría estándar |

Índices: `dispositivo_id`, `recibido_en`, `fecha_hora_finalizacion` — los tres ejes por los que filtra
y ordena el portal. `estado` queda como índice heredado de v1, hoy con cardinalidad 1 (`completada`).

### Tabla `encuestas_dispositivos`

| Columna | Tipo | Origen | Semántica |
|---|---|---|---|
| `id` | `integer` PK | servidor | Referenciado por `encuestas.dispositivo_id` |
| `identificador` | `text` | operador (CLI) | Nombre humano del equipo (`encuestador-01`). Es lo que se ve en el portal y en el CSV |
| `key_hash` | `text` UNIQUE | servidor | SHA-256 (o HMAC con pepper) de la API key. **La key en claro no se guarda en ningún sitio** |
| `activo` | `boolean` | operador (CLI) | `false` = revocado: la key responde `401` y las encuestas ya recibidas se conservan |
| `last_used_at` | `timestamp` NULL | servidor | Última autenticación correcta (best-effort, no bloquea la petición) |
| `created_at` / `updated_at` | `timestamp` | servidor | Auditoría estándar |

---

## Variables de entorno (todas opcionales, con default)

| Variable | Default | Para qué |
|---|---|---|
| `ENCUESTAS_RATE_MAX` | `60` | Cuota por dispositivo y ventana (`rl:enc:dev:`) |
| `ENCUESTAS_RATE_WINDOW_SEC` | `60` | Ventana de los dos cubos, en segundos (mínimo 10) |
| `ENCUESTAS_IP_RATE_MAX` | `120` | Cuota por IP y ventana (`rl:enc:ip:`), pre-auth. Es `2 × ENCUESTAS_RATE_MAX`: si cambias esa, ajusta esta a mano |
| `ENCUESTAS_KEY_PEPPER` | — | Pepper opcional: pasa el hash de las API keys de SHA-256 a HMAC-SHA256 |

**Ninguna hace falta** en el `.env` del servidor ni en las plantillas (`env.staging.plantilla.txt`,
`.env.example`, `.env.public.example`): todas traen default en `api/src/config/env.ts` y ninguna es
un secreto obligatorio, así que `env.ts` no aborta si faltan. Es el mismo criterio que las
`QA_EXTERNA_*` (`docs/qa-externa.md`). Solo se declaran si se quiere apartar del default.

> Si defines `ENCUESTAS_KEY_PEPPER`, **debe pasarse también al CLI de alta**
> (`-e ENCUESTAS_KEY_PEPPER=...`). El CLI hashea la key con el mismo algoritmo que el middleware:
> con peppers distintos, el hash almacenado no coincidirá nunca con el calculado al autenticar y la
> key emitida quedará muerta desde el minuto cero.

---

## Operación

### Migración

La API **no migra sola**. En el VPS público la vía canónica es `./deploy-public.sh`: su servicio
one-shot `migrate` aplica `prisma migrate deploy` antes de `api`/`web`
(`condition: service_completed_successfully`) y es el único camino que pasa el guard
`FLOTILLAS_PREDEPLOY_GUARD` (un `docker compose run`/`up` manual aborta con exit 78 a propósito:
el script hace backup antes de tocar el esquema). Si hiciera falta correrla a mano con el stack
ya levantado:

```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.public.yml"
$COMPOSE run --rm --no-deps api npx prisma migrate deploy
```

La migración del módulo es **sin TRUNCATE**: reestructura las columnas v1 a v3 con `ALTER` y `UPDATE`,
conservando cualquier fila v1 residual que pudiera existir en BD de desarrollo (producción nunca tuvo
datos v1 porque el módulo no llegó a producción). Elimina las columnas v1 obsoletas, normaliza
`estado` a `completada`, y agrega las columnas v3 (todas NULLABLE a propósito, la validación
impone la obligatoriedad). El gate de migraciones (`test:migrations`) lo prohíbe TRUNCATE/DELETE
sobre tablas `encuestas*`, y esa restricción se aplica aquí.

### Pruebas

```bash
cd api
npm run test:sprint5     # suite del módulo (vitest)
```

El CI la corre en el job `API`, en el paso **“Sprint 5 encuestas Okrean tests”**, justo después del
de sprint 4 (`.github/workflows/ci.yml`). Sin ese paso los tests existirían pero nadie los
ejecutaría — el CI nunca corre `npm test` a secas.

### Despliegue en el VPS público

El de siempre: `./deploy-public.sh` (ver `docs/runbook-hetzner.md`). Recordatorios que aplican aquí:

- tras editar el `.env`, `up -d --force-recreate` — un `restart` **no** recarga variables;
- la pestaña nueva del portal es código de Next, así que exige **rebuild de `web`**.

Humo manual tras el deploy:

```bash
curl -sS https://qa.aztechcomposites.com/api/v1/encuestas/ping -H 'Authorization: Bearer <API KEY>'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://qa.aztechcomposites.com/api/v1/encuestas \
  -H 'Authorization: Bearer <API KEY>' -H 'Content-Type: application/json' -d @encuesta.json
# 201 la primera vez, 200 la segunda (mismo idRemoto)
```

### Portal de revisión

Pestaña **Encuestas** en `/revision/encuestas`, junto a las dos de GeoCampo
(`web/src/app/revision/layout.tsx`):

| Pestaña | Ruta | Contenido |
|---|---|---|
| Evidencias de campo | `/revision/evidencias` | GeoCampo: fotos + exportación ZIP |
| Registro de personas | `/revision/personas` | GeoCampo: listado + CSV |
| **Encuestas** | `/revision/encuestas` | **Encuestas Okrean: listado + CSV** |

Se entra con la **misma cuenta `REVISOR_QA`** que ya usan los revisores de GeoCampo: no hay que
crear usuarios nuevos ni un rol aparte. Lo que sí está separado son **los datos**: la pestaña de
Encuestas solo lee `encuestas`, y las de GeoCampo solo leen sus propias tablas. El login sigue
siendo `/revision/login`.

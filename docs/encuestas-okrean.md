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
| `estado` | opcional | opcional | `completada` \| `noElegible` |
| `dispositivo` | opcional | opcional | Texto: coincide contra el `identificador` del dispositivo registrado |
| `dateFrom` / `dateTo` | opcional | **obligatorios** | `AAAA-MM-DD` sobre `fechaHoraFinalizacion`. Día civil completo en **UTC** con **tope superior exclusivo** (`dateTo` + 1 día). En exportación: `dateTo ≥ dateFrom` y rango máximo **366 días** |

Cada elemento de `data` (`EncuestaDto`): `id`, `idRemoto`, `folioLocal`, `estado`, `elegibilidad`,
`versionCuestionario`, `partidoPreferido`, `candidatoPreferido`, `duracionSegundos`,
`fechaHoraFinalizacion`, `recibidoEn`, `ubicacionDisponible` y `dispositivo: { id, identificador }`.
El listado **no expone** `payloadRaw`, `payloadHash`, las coordenadas ni los JSON de respuestas: la
pantalla es un índice, el detalle fino sale por el CSV.

Parámetros inválidos → `400 {"error":"Parámetros inválidos","code":"BAD_REQUEST","details":[{"field","message"}]}`.
Sin sesión → `401`; con sesión de otro rol → `403`.

El contrato de la cara de dispositivo está además en formato máquina:
**`docs/encuestas-okrean-openapi.yaml`** (OpenAPI 3.1). Se mantiene a mano porque el generador
runtime (`/api/docs`) está apagado en producción (`api/src/index.ts:224-226`).

---

## Contrato v1 del payload

Un solo `Content-Type`: `application/json`. Al ser JSON (y no multipart), **los números viajan como
números**: `"duracionSegundos": "397"` es un `422`, no un 397.

### Campos comunes a las dos ramas

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `idLocal` | string UUID | sí | **Clave de idempotencia** (UNIQUE global, no por dispositivo). Estable entre reintentos, jamás reutilizado |
| `folioLocal` | string | **no** | Folio de papel. Formato `LX-<dígitos>`. **No es único**: dos teléfonos pueden emitir el mismo folio y los dos se aceptan |
| `versionCuestionario` | entero | sí | Hoy solo `1`. Otro entero → `422 UNSUPPORTED_VERSION`; algo que no sea entero positivo → `422 VALIDATION_ERROR` |
| `estado` | `completada` \| `noElegible` | sí | Discrimina la rama; decide qué campos son obligatorios y cuáles están prohibidos |
| `elegibilidad` | `elegible` \| `noElegible` | sí | Atado a `estado`: `completada`⇒`elegible`, `noElegible`⇒`noElegible`. Cualquier otra combinación es `422` |
| `fechaHoraInicio` | string ISO-8601 **con `Z`** | sí | |
| `fechaHoraFinalizacion` | string ISO-8601 **con `Z`** | sí | Debe ser ≥ `fechaHoraInicio` |
| `duracionSegundos` | entero ≥ 0 | sí | Se contrasta con el intervalo; ver *tolerancia* abajo |
| `respuestas` | objeto | sí | **Las respuestas del cuestionario van anidadas aquí, no en la raíz.** Su forma depende de la rama |
| `ubicacion` | objeto | **no** | Bloque completo o ausente. **`null` no se acepta**; ver *Ubicación* |
| `dispositivo` | objeto | sí | `{ plataforma, modelo, versionSistema }` — texto no vacío, máx. 120 caracteres cada uno |
| `versionAplicacion` | string | sí | Versión de la app (máx. 60 caracteres). Entra al hash canónico |

> ⚠️ **P1–P8 no viven en la raíz del payload.** Van dentro del objeto `respuestas`
> (`"respuestas": { "credencialVigente": "si", … }`). Mandarlas sueltas en la raíz es `422`: el
> schema exige `respuestas` y descarta lo que sobra.

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

### Rama `completada` (encuestado elegible) — contenido de `respuestas`

Con `estado: "completada"` y `elegibilidad: "elegible"`. Dentro de `respuestas`, **todos
obligatorios**:

| Campo | Tipo | Notas |
|---|---|---|
| `credencialVigente` | `si` | P1. En esta rama solo puede valer `si` |
| `rangoEdad` | catálogo | P2 |
| `genero` | catálogo | P3 |
| `partidoPreferido` | catálogo | P4 |
| `conocimientoPorPersona` | array de `{persona, nivel}` | P5. **Exactamente las 7 personas del catálogo, una vez cada una.** Faltantes, repetidas o desconocidas → `422`. El orden **no importa**: el servidor lo normaliza antes de hashear |
| `mediosConocimiento` | objeto discriminado por `tipo` | P6. Ver abajo |
| `mayorPersonalidad` | catálogo de personas | P7 |
| `candidatoPreferido` | catálogo de personas | P8 |

### Rama `noElegible` (sin credencial vigente) — contenido de `respuestas`

Con `estado: "noElegible"` y `elegibilidad: "noElegible"`. La app corta el cuestionario en P1, así
que `respuestas` solo lleva dos claves:

```json
"respuestas": { "credencialVigente": "no", "conocimientoPorPersona": [] }
```

`conocimientoPorPersona` **debe venir vacío** (no basta con omitirlo).

**P2–P8 no se declaran en el schema de esta rama**, así que si el teléfono manda el borrador previo
al "no" de P1, el servidor lo **descarta** antes de hashear y esas columnas quedan en `NULL`. No es
un error: la petición se acepta igual (`201`). El único rastro del envío original queda en
`payload_raw`, que nunca sale del servidor.

### Catálogos v1

Son **texto validado en la aplicación**, no enums de PostgreSQL: así se puede publicar un
cuestionario v2 sin `ALTER TYPE`. Un valor fuera del catálogo es `422`, nunca un guardado silencioso.

| Catálogo | Valores |
|---|---|
| **Personas** (7) | `lalo_ximenez`, `laura_estrada`, `paco_nino`, `gabriela_delgado`, `irineo_molina`, `goyo_castaneda`, `ernesto_montero` |
| **Nivel de conocimiento** (P5) | `no_conoce`, `poco`, `algo`, `bien` |
| **Medios** (P6) | `redes_sociales`, `otras_personas`, `labor_social` |
| **Partido** (P4) | `morena`, `pri`, `ninguno_no_sabe`, `prd`, `mc`, `pvem`, `pt`, `independiente`, `panal`, `pan` |
| **Rango de edad** (P2) | `18_29`, `30_44`, `45_59`, `60_mas` |
| **Género** (P3) | `hombre`, `mujer`, `otro` |
| **Estado** | `completada`, `noElegible` |
| **Elegibilidad** | `elegible`, `noElegible` |

El orden de la tabla de **Personas** es el orden canónico: es el que usa el hash de idempotencia y
el que ordena las 7 columnas pivoteadas del CSV.

### P5 ↔ P6: la única regla condicional del cuestionario

`respuestas.mediosConocimiento` es una unión discriminada por `tipo`, y su forma la decide
`respuestas.conocimientoPorPersona`. Se valida **en los dos sentidos**:

| Situación en P5 | Forma exigida de P6 |
|---|---|
| El encuestado **no conoce a nadie**: las 7 filas con `nivel: "no_conoce"` — la app no pregunta P6 | `{"tipo":"omitidaPorLogica"}` |
| Conoce al menos a una persona (algún `nivel ≠ no_conoce`) | `{"tipo":"respondida","medios":["redes_sociales", …]}` con **al menos un medio** y **sin repetidos** |

Las dos direcciones se rechazan: P6 respondida sobre gente que dijo no conocer, y P6 omitida cuando
sí conoce a alguien. También son `422` mandar `respondida` con `medios: []`, mandar
`omitidaPorLogica` acompañada de `medios`, o repetir un medio.

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
| `422` | `{"error":"Datos inválidos","code":"VALIDATION_ERROR","issues":[{"field","message"}],…}` | El JSON es válido pero no pasa el cuestionario v1 | No: terminal |
| `422` | `{"error":…,"code":"UNSUPPORTED_VERSION",…}` | `versionCuestionario` entero distinto de 1 | No: hay que actualizar el servidor |
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

**Qué entra al hash:** todo lo sustantivo, incluidos `dispositivo{…}` y `versionAplicacion`.
**Qué queda fuera:** el `idRemoto` que mande el cliente y los cuatro campos de sincronización
(`estadoSincronizacion`, `numeroIntentosSincronizacion`, `fechaUltimoIntento`,
`fechaSincronizacion`).

Antes de hashear se **normaliza**, para que reenvíos equivalentes den el mismo hash:

- fechas a ISO-8601 UTC (`2026-07-30T16:18:41Z`, `…+00:00` y `…16:18:41.000Z` son la misma);
- `folioLocal` ausente ≡ `null`;
- `ubicacion` ausente ≡ `null`;
- `conocimientoPorPersona` reordenado al orden del catálogo de personas y `medios` al orden del
  catálogo de medios (el orden en que el teléfono arma los arrays no es información);
- orden de claves fijo por construcción, así que no depende de cómo llegó el body.

La forma canónica lleva un campo `v` con la versión del **algoritmo** de canonicalización (no la del
cuestionario): si alguna de estas reglas cambia, subirlo evita comparar hashes viejos contra nuevos
como si fueran del mismo esquema (`api/src/lib/encuestasCanonical.ts`).

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
  "versionCuestionario": 1,
  "estado": "completada",
  "elegibilidad": "elegible",
  "fechaHoraInicio": "2026-07-30T16:12:04.000Z",
  "fechaHoraFinalizacion": "2026-07-30T16:18:41.000Z",
  "duracionSegundos": 397,
  "respuestas": {
    "credencialVigente": "si",
    "rangoEdad": "30_44",
    "genero": "mujer",
    "partidoPreferido": "morena",
    "conocimientoPorPersona": [
      {"persona": "lalo_ximenez",     "nivel": "bien"},
      {"persona": "laura_estrada",    "nivel": "algo"},
      {"persona": "paco_nino",        "nivel": "poco"},
      {"persona": "gabriela_delgado", "nivel": "no_conoce"},
      {"persona": "irineo_molina",    "nivel": "poco"},
      {"persona": "goyo_castaneda",   "nivel": "no_conoce"},
      {"persona": "ernesto_montero",  "nivel": "algo"}
    ],
    "mediosConocimiento": {"tipo": "respondida", "medios": ["redes_sociales", "otras_personas"]},
    "mayorPersonalidad": "lalo_ximenez",
    "candidatoPreferido": "lalo_ximenez"
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
  "versionAplicacion": "1.4.0"
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

Si en cambio cambias un campo **sustantivo** (por ejemplo `respuestas.partidoPreferido`) manteniendo
el `idLocal`, la respuesta es `409` y la fila original queda intacta.

### 3. Encuesta no elegible → `201`

```bash
curl -sS -i -X POST https://qa.aztechcomposites.com/api/v1/encuestas \
  -H 'Authorization: Bearer <API KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
  "idLocal": "b2d4e6f8-1a3c-4d5e-8f90-a1b2c3d4e5f6",
  "folioLocal": "LX-001249",
  "versionCuestionario": 1,
  "estado": "noElegible",
  "elegibilidad": "noElegible",
  "fechaHoraInicio": "2026-07-30T16:22:10.000Z",
  "fechaHoraFinalizacion": "2026-07-30T16:22:48.000Z",
  "duracionSegundos": 38,
  "respuestas": {
    "credencialVigente": "no",
    "conocimientoPorPersona": []
  },
  "ubicacion": {
    "disponible": false,
    "permiso": "denegado",
    "servicioActivo": true,
    "motivoNoDisponible": "permisoDenegado"
  },
  "dispositivo": {"plataforma": "android", "modelo": "Moto G54", "versionSistema": "14"},
  "versionAplicacion": "1.4.0"
}'
```

```
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{"idRemoto":"5e8b1c33-72a0-4f19-9d6e-4b0c7a2f8e51"}
```

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
$COMPOSE run --rm -e DEVICE_NAME="encuestador-01" api npm run encuestas:device:register
```

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
$COMPOSE run --rm -e DEVICE_ID=3 api npm run encuestas:device:revoke
# o por nombre:
$COMPOSE run --rm -e DEVICE_NAME="encuestador-01" api npm run encuestas:device:revoke
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
`encuestas-<estado|todas>-<dateFrom>_<dateTo>.csv`.

**38 columnas**, en este orden (el rótulo y el orden exactos los fija `ENCUESTAS_CSV_HEADERS` en
`api/src/services/encuestasRevisionService.ts`):

| Bloque | Columnas |
|---|---|
| Identidad | Folio local · ID remoto · ID local |
| Tiempos | Recibido (UTC) · Inicio (UTC) · Finalización (UTC) · Duración (s) |
| Clasificación | Estado · Versión cuestionario |
| P1–P4 | Credencial vigente · Rango de edad · Género · Partido preferido |
| P5 (pivoteada) | 7 columnas `Conoce <persona>`, en el orden del catálogo de personas. **Vacías** en las encuestas `noElegible` |
| P6 | Medios (tipo) · Medios (la lista unida con `;`) |
| P7–P8 | Mayor personalidad · Candidato preferido |
| Ubicación | Disponible · Latitud · Longitud · Precisión (m) · Capturada (UTC) · Válida · Permiso · Servicio activo · Motivo sin ubicación |
| Dispositivo | Plataforma · Modelo · Versión del sistema · Versión de la app · Dispositivo (identificador de la API key) |

Las fechas salen en **ISO UTC** (igual que se persisten: la hora local del revisor no debe cambiar
el contenido del archivo) y los booleanos como `si` / `no` / celda vacía.

**`payload_raw` y `payload_hash` no se exportan nunca**, ni salen en el listado: son auditoría
interna.

Las celdas de **texto** que empiezan por `=`, `+`, `-`, `@`, TAB o CR salen precedidas de un
apóstrofo — la marca de "esto es texto" de Excel. No es cosmética: el modelo del teléfono, el folio
y la versión de la app son **texto libre que manda el dispositivo**, y una celda `=HYPERLINK(...)`
se ejecutaría en la máquina del revisor al abrir el archivo. Las columnas numéricas quedan exentas
para no romper latitud/longitud/precisión.

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
| `version_cuestionario` | `integer` | cliente (validado) | Hoy siempre `1` |
| `folio_local` | `text` NULL | cliente (validado) | Folio de papel `LX-<dígitos>`. **No único** |
| `estado` | enum `EncuestaEstado` | cliente (validado) | `completada` \| `noElegible` |
| `elegibilidad` | enum `EncuestaElegibilidad` | cliente (validado) | `elegible` \| `noElegible`, atada a `estado` |
| `fecha_hora_inicio` | `timestamp` | cliente (validado) | Inicio de la entrevista, según el reloj del teléfono |
| `fecha_hora_finalizacion` | `timestamp` | cliente (validado) | Fin de la entrevista. **Es el campo por el que filtra el revisor** |
| `duracion_segundos` | `integer` | cliente (validado) | Cronómetro de la app, contrastado con el intervalo (±60 s) |
| `credencial_vigente` | `text` | cliente (validado) | P1, de `respuestas.credencialVigente`: `si` \| `no` |
| `rango_edad` | `text` NULL | cliente (validado) | P2, de `respuestas.rangoEdad`. `NULL` en `noElegible` |
| `genero` | `text` NULL | cliente (validado) | P3, de `respuestas.genero`. `NULL` en `noElegible` |
| `partido_preferido` | `text` NULL | cliente (validado) | P4, de `respuestas.partidoPreferido`. `NULL` en `noElegible` |
| `conocimiento_por_persona` | `jsonb` NULL | cliente (validado) | P5: `[{persona,nivel}]` ×7, en orden canónico. `NULL` en `noElegible` |
| `medios_conocimiento` | `jsonb` NULL | cliente (validado) | P6: `{tipo}` u `{tipo,medios[]}`. `NULL` en `noElegible` |
| `mayor_personalidad` | `text` NULL | cliente (validado) | P7, de `respuestas.mayorPersonalidad`. `NULL` en `noElegible` |
| `candidato_preferido` | `text` NULL | cliente (validado) | P8, de `respuestas.candidatoPreferido`. `NULL` en `noElegible` |
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

Índices: `dispositivo_id`, `recibido_en`, `fecha_hora_finalizacion`, `estado` — los cuatro ejes por
los que filtra y ordena el portal.

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

La API **no migra sola**. Antes de servir tráfico, siempre:

```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.public.yml"
$COMPOSE run --rm api npx prisma migrate deploy
```

O, si el perfil tiene el servicio one-shot `migrate`, dejar que corra antes de `api`/`web`
(`condition: service_completed_successfully`). La migración de este módulo es **aditiva pura**:
2 enums + 2 tablas + índices + FK; no toca nada existente.

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

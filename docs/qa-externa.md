# qa_externa — Ingesta de Evidencia Externa (GeoCampo)

Módulo aditivo que recibe capturas de campo desde la app móvil GeoCampo. Son **dos**: la
evidencia (una o más fotos JPEG + geo-metadatos) y el **registro de personas** (sin foto:
nombre, teléfono y GPS). Ambas comparten la misma API key de dispositivo (Bearer), la misma
**cifra** de cuota por dispositivo —pero **cada una lleva su propio contador**, ver §Rate-limit— y
la misma idempotencia por UUID de cliente; la evidencia además deduplica imágenes por sha256.

## Endpoints (cara de DISPOSITIVO — API key)

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| POST | `/api/qa-externa/ingest` | `Authorization: Bearer <api_key>` | `200 { "registro_id": <number>, "imagenes": [ { "id", "sha256", "bytes", "mime", "width", "height" } ] }` |
| POST | `/api/qa-externa/personas` | `Authorization: Bearer <api_key>` | `200 { "registro_id": <number> }` |
| GET | `/api/qa-externa/ping` | Bearer | `200 {"ok":true}` (sin/mala key → 401) |
| GET | `/api/qa-externa/ingest` | Bearer | `405` tras autenticar (red de seguridad para la app actual) |
| GET | `/api/qa-externa/personas` | Bearer | `405` tras autenticar — **no 401** (misma red de seguridad; ver §Respuestas) |

Campos del `multipart/form-data` del POST `/ingest`: `cliente_registro_id` (UUID),
`identificador_app`, `lat`, `lng`, `accuracy` (opcional), `capturado_at` (ISO-8601 UTC),
`metadata` (`{"tipo":"lona|reunion|barda|otro","notas":<string|null>}`), `imagenes[]` (1..N JPEG;
nombre de campo literal con corchetes). Errores de auth → **401**; validación → **400**
`VALIDATION_ERROR`; otros → 4xx/5xx (reintentables).

### Idempotencia y dedupe
- Reenviar el mismo `cliente_registro_id` actualiza el registro y devuelve el **mismo** `registro_id`.
- Reenviar la misma imagen (mismo sha256) no re-guarda bytes ni duplica el vínculo.

## Registro de personas (segunda captura, SIN foto)

`POST /api/qa-externa/personas`. Acepta **`application/json` o `multipart/form-data` sin
archivos** — las dos formas funcionan, porque el equipo móvil reutiliza el mismo uploader
multipart de `/ingest` y otros clientes mandan JSON plano
(`api/src/routes/qaExternaRouter.ts:181-191`).

> ⚠️ **El multipart de `/personas` NO debe incluir ninguna parte de archivo.** Si se reutiliza el
> uploader de `/ingest` tal cual —el que **siempre** adjunta `imagenes[]`— la petición se aborta y
> **no se guarda nada**: se responde
> `400 {"error":"Demasiados archivos","code":"LIMIT_FILE_COUNT"}`. Es `multer(...).none()` con
> `limits.files: 0` cortando la parte de archivo antes de que exista el handler
> (`api/src/routes/qaExternaRouter.ts:181-183`), traducido por
> `api/src/middlewares/errorHandler.ts:135,145`. Al portar el uploader hay que **quitar el adjunto**,
> no confiar en que el servidor lo ignore.
>
> Mismos `limits` acotan la forma del formulario: máx. **20 campos** de texto, **25 partes** y
> **64 KB por campo** (`qaExternaRouter.ts:182`). Pasarse devuelve 400 con `LIMIT_FIELD_COUNT`
> ("Demasiados campos en el formulario"), `LIMIT_PART_COUNT` o `LIMIT_FIELD_VALUE`
> (`errorHandler.ts:140-143`). Los 9 campos que manda GeoCampo caben de sobra.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_registro_id` | string UUID | sí | Clave de idempotencia |
| `identificador_app` | string 1..200 | sí | Etiqueta del dispositivo/instancia |
| `nombre` | string 1..200 | sí | Se recorta (`trim`) |
| `telefono` | string | sí | Laxo: 7..20 caracteres de `[+ ( ) 0-9 espacio -]`, con **7..15 dígitos reales** (los separadores no cuentan) |
| `lat` | decimal (string o number) | sí | −90..90. En multipart llega como string y se convierte. **`null`, `""` y cualquier no-número → 400**, nunca 0 |
| `lng` | decimal (string o number) | sí | −180..180. Mismo trato que `lat` |
| `accuracy` | decimal (string o number) | **no** | ≥ 0 (metros). **Ausente, `null`, `""` o solo espacios → se persiste `NULL`** (nunca 0) |
| `capturado_at` | string ISO-8601 **con sufijo `Z`** | sí | Se persiste en UTC. Sin offset se interpreta en la zona del contenedor (ver aviso abajo) |
| `metadata` | JSON (string en multipart, objeto en JSON) | **no** | Se guarda crudo en `metadata_raw`; JSON roto → 400. **Tope 64 KB por las dos vías** (multipart y JSON): pasarse → 400. Aquí **no** transporta `tipo`/`notas` (eso es solo de `/ingest`) |

> **`programa` y `dispositivo_id` los estampa el SERVIDOR** desde la API key autenticada
> (`api/src/routes/qaExternaRouter.ts:274,278`). El cliente **nunca** los envía, y mandarlos en el
> body **no tiene ningún efecto**: el handler solo lee los campos de la tabla de arriba.

#### `null` en la posición: `lat`/`lng` se rechazan, `accuracy` no

Distinción deliberada, y solo la nota el cliente **JSON** (en multipart todo viaja como texto: un
campo vacío llega `""` y uno ausente `undefined`, el `null` es imposible de expresar):

- **`lat` y `lng` son obligatorias.** `null`, `""`, `"   "`, `true`/`false`, `[]` y `{}` se rechazan
  con `400 VALIDATION_ERROR` y el mensaje `lat debe ser un número` / `lng debe ser un número`. La
  puerta se cierra **antes** del `z.coerce.number()`, porque `Number(null) === Number("") === 0` y
  un `{"lat":null,"lng":null}` se habría guardado con 200 OK como una captura en el golfo de
  Guinea (`api/src/validators/qaExternaPersonaValidator.ts:37-38,63-74`).
- **`accuracy` es opcional y admite las cuatro formas de "el GPS no reportó precisión"**: ausente,
  `null`, `""` y una cadena de solo espacios (`"   "`, lo que manda un cliente multipart que rellena
  sus campos con un espacio cuando no tiene dato). Las cuatro se normalizan a `undefined` antes del
  coerce y la columna queda en `NULL` — **jamás en 0**, que sería una precisión perfecta, no un dato
  faltante (`qaExternaPersonaValidator.ts:88-97` y el guard del router en `qaExternaRouter.ts`). Un
  `accuracy` negativo sí es 400 (`accuracy no puede ser negativa`); `0` y `"0"` se aceptan tal cual.

En el CSV del revisor, una `accuracy` en `NULL` sale como **celda vacía**, no como el texto `null`
(`api/src/services/qaExternaPersonasService.ts:219`).

> ⚠️ **`capturado_at`: manda SIEMPRE el sufijo `Z`.** La validación es `Date.parse`
> (`api/src/validators/qaExternaPersonaValidator.ts:98-103`), y una cadena ISO de fecha **y hora**
> sin designador de zona la interpreta el estándar en la **hora local del proceso**, no en UTC.
> Hoy es inocuo porque ningún compose define `TZ` (`grep -rn "TZ" docker-compose*.yml` → sin
> coincidencias) y los contenedores corren en UTC, así que
> `2026-06-15T18:30:00.000` y `2026-06-15T18:30:00.000Z` se guardan igual. Pero basta con que
> alguien añada `TZ=America/Mexico_City` al compose para que la misma cadena sin `Z` se desplace
> **6 horas** (medido: `TZ=America/Mexico_City node -e "…Date.parse('2026-06-15T18:30:00.000')…"`
> → `2026-06-16T00:30:00.000Z`), y con ella el día civil por el que filtra el revisor. Con el
> sufijo `Z` el resultado no depende del contenedor.

> **Las MISMAS API keys sirven para evidencias y para personas.** El alta/revocación de
> dispositivos **no cambia** (ver abajo): la key ya existente de un dispositivo funciona en
> `/personas` sin ningún trámite adicional.

### Ejemplos

JSON:
```bash
curl -sS -H "Authorization: Bearer <API KEY>" --json '{
  "cliente_registro_id": "11111111-2222-3333-4444-555555555555",
  "identificador_app": "geocampo-zona-norte",
  "nombre": "María Pérez",
  "telefono": "+52 55 1234 5678",
  "lat": 19.432608,
  "lng": -99.133209,
  "accuracy": 8.5,
  "capturado_at": "2026-06-15T18:30:00.000Z",
  "metadata": {"origen":"visita"}
}' https://qa.aztechcomposites.com/api/qa-externa/personas
```

Multipart (sin archivos), tal como lo manda hoy la app:
```bash
curl -sS -H "Authorization: Bearer <API KEY>" \
  -F "cliente_registro_id=11111111-2222-3333-4444-555555555555" \
  -F "identificador_app=geocampo-zona-norte" \
  -F "nombre=María Pérez" \
  -F "telefono=(55) 1234-5678" \
  -F "lat=19.432608" -F "lng=-99.133209" -F "accuracy=8.5" \
  -F "capturado_at=2026-06-15T18:30:00.000Z" \
  -F 'metadata={"origen":"visita"}' \
  https://qa.aztechcomposites.com/api/qa-externa/personas
```

### Respuestas

| Código | Cuerpo | Cuándo |
|---|---|---|
| `200` | `{"registro_id": <number>}` | Alta o actualización idempotente |
| `401` | `{"error":"API key requerida"\|"API key inválida o revocada"\|"Formato inválido. Use: Bearer <api_key>","code":"UNAUTHORIZED"}` | Sin `Authorization`, key desconocida o dispositivo revocado (`activo=false`) |
| `400` | `{"error":"Datos inválidos","code":"VALIDATION_ERROR","issues":[{"field","message"}]}` | Falla del schema — **mismo formato que `/ingest`** |
| `400` | `{"error":"metadata no es un JSON válido","code":"BAD_REQUEST"}` | `metadata` string que no parsea |
| `400` | `{"error":"metadata excede el tamaño máximo de 64 KB","code":"BAD_REQUEST"}` | `metadata` mayor de 64 KB por la vía **JSON**. Por multipart el mismo exceso lo corta multer antes (`LIMIT_FIELD_VALUE`): es el mismo tope, aplicado en los dos caminos desde una sola constante (`api/src/routes/qaExternaRouter.ts:179,231-236`) |
| `400` | `{"error":"Demasiados archivos","code":"LIMIT_FILE_COUNT"}` | El multipart traía una parte de archivo (p. ej. `imagenes[]` heredado del uploader de `/ingest`) |
| `405` | `{"error":"Method Not Allowed","code":"METHOD_NOT_ALLOWED"}` | `GET /api/qa-externa/personas` con key válida. Existe a propósito: sin él la petición salía del router y la atrapaban los comodines `app.use('/api', authMiddleware, …)` (`api/src/index.ts:269,274`), cuyo `authMiddleware` de JWT devolvía **401** — que el móvil lee como "API key inválida" y dispara una reconfiguración innecesaria (`qaExternaRouter.ts:193-200`) |
| `429` | `{"error":"Demasiados registros de personas desde este dispositivo. Intenta más tarde.","code":"RATE_LIMITED"}` | Rate-limit por dispositivo — **cubo propio de `/personas`**, ver abajo |

**Idempotencia:** reenviar el mismo `cliente_registro_id` **no crea otra fila**; actualiza la
existente (last-write-wins, sin tocar el propio `cliente_registro_id`) y devuelve el **mismo**
`registro_id`. La app puede reintentar sin miedo a duplicar contactos.

### Rate-limit: tres cubos — las CUOTAS DE CAPTURA no se comparten entre `/ingest` y `/personas`

Los tres llevan **contadores independientes entre sí** y la misma ventana,
`QA_EXTERNA_RATE_WINDOW_SEC` (**60 s**). Cada captura tiene su propio cubo **por dispositivo**; el
tercero, el de anti-sondeo **por IP**, sí es común a las dos rutas —corre antes de autenticar y no
puede distinguirlas—, y por eso lleva el doble de cuota (ver debajo de la tabla):

| Cubo | Clave en Redis | Alcance | Cuota | Qué protege | Mensaje del 429 |
|---|---|---|---|---|---|
| Evidencia (por dispositivo) | `rl:qae:dev:<dispositivo_id>` | Solo `POST /ingest` (`api/src/routes/qaExternaRouter.ts:57-62`) | `QA_EXTERNA_RATE_MAX` (**60**) | Cuota de subida de evidencia | `Demasiadas subidas desde este dispositivo. Intenta más tarde.` |
| Personas (por dispositivo) | `rl:qae:per:<dispositivo_id>` | Solo `POST /personas` (`qaExternaRouter.ts:64-69`) | `QA_EXTERNA_RATE_MAX` (**60**) | Cuota del registro de personas | `Demasiados registros de personas desde este dispositivo. Intenta más tarde.` |
| Por IP (pre-auth) | `rl:qae:ip:<ip>` | Todo `/api/qa-externa/*` (`api/src/index.ts:252-258`) | `QA_EXTERNA_IP_RATE_MAX` (**120**) | Sondeo de API keys | `Demasiados intentos. Espera <n>s.` |

Los dos cubos por dispositivo van separados para que un teléfono que estuvo sin señal y vacía las
dos colas al recuperarla no sacrifique las subidas de evidencia —las caras, con fotos— por el
goteo de personas: son 60 evidencias **y** 60 personas por minuto y dispositivo.

El cubo por IP **sí abarca las dos rutas** —corre antes de autenticar, así que no puede saber qué
captura es—, y por eso lleva el **doble** de cuota (120 = 2 × 60): con el mismo número, ese mismo
teléfono (p. ej. 50 personas + 20 evidencias en un minuto = 70 > 60) recibiría el 429 por la puerta
de atrás y las que morirían serían justo las evidencias, que se envían después. Su clave lleva
prefijo propio (`qae:ip:`) en vez del `ip:` por defecto: ese cubo genérico lo comparte
`publicRouter` con cuota 10, y sin prefijo el tráfico de GeoCampo consumía el del portal público.

Todo 429 llega con cabecera `Retry-After` en segundos (`api/src/middlewares/rateLimit.ts:54`).

## Consulta del registro de personas (cara REVISOR — JWT)

Vive fuera de `/api/qa-externa/*` (que es el montaje por API key): montado en
`/api/qa-externa-personas` con `authMiddleware` (JWT por cookie `token`, o header `Bearer` por
compatibilidad) y **rol `REVISOR_QA`
exclusivo** (`api/src/index.ts:293`, `api/src/routes/qaExternaPersonasRouter.ts:28,100,110`).

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/qa-externa-personas` | `200 { "data": [ <persona> ], "pagination": { "page", "limit", "total", "totalPages" } }` |
| GET / HEAD | `/api/qa-externa-personas/export.csv` | `200 text/csv; charset=utf-8` como adjunto. `HEAD` solo valida filtros y cabeceras (no toca la BD) |

Parámetros de consulta:

| Parámetro | Listado | Exportación | Notas |
|---|---|---|---|
| `page` / `limit` | opcional | — | Default 20, tope 100 |
| `programa` | opcional | opcional | `BUFFALO` \| `LX` |
| `dispositivo` | opcional | opcional | ID entero positivo del dispositivo registrado |
| `dateFrom` / `dateTo` | opcional | **obligatorios** | `AAAA-MM-DD`. Día civil completo en **UTC**, con tope superior exclusivo. En exportación: `dateTo ≥ dateFrom` y rango máximo **366 días** |
| `q` | opcional | opcional | Búsqueda libre (máx. 100 chars) sobre `nombre` (sin distinguir mayúsculas) y `telefono` (substring) |

Cada elemento de `data`: `id`, `clienteRegistroId`, `identificadorApp`, `programa`, `nombre`,
`telefono`, `lat`, `lng`, `accuracy`, `capturadoAt`, `createdAt` y
`dispositivo: { id, identificador }`. Ordenado por **`capturadoAt` descendente** — lo más reciente
arriba (`api/src/services/qaExternaPersonasService.ts:136`). El `metadata_raw` del dispositivo
**no se expone**.

Parámetros inválidos → `400 {"error":"Parámetros inválidos","code":"BAD_REQUEST","details":[{"field","message"}]}`.
Sin sesión → `401`; con sesión de otro rol → `403`.

**CSV** (`export.csv`): se sirve en streaming por lotes de 1 000 filas, con **BOM UTF-8** (para
que Excel en Windows no rompa los acentos) y saltos `CRLF`. Nombre del archivo:
`personas-<programa|todos>-<dateFrom>_<dateTo>.csv`. Columnas, en este orden:

`Nombre`, `Teléfono`, `Latitud`, `Longitud`, `Precisión (m)`, `Capturado (UTC)`, `Programa`,
`Dispositivo` (equipo registrado que porta la API key), `Celular` (`identificador_app`),
`ID cliente` (`cliente_registro_id`).

**Un fallo de BD ANTES del primer lote sale como `500`**, no como un CSV con solo la fila de
encabezados: el BOM y los encabezados no se escriben hasta tener ese lote en mano
(`api/src/routes/qaExternaPersonasRouter.ts:117-159`). Si el fallo llega **a media descarga** ya no
hay arreglo posible dentro de HTTP/1.1 —el `200` y las cabeceras viajaron con el primer byte y solo
los trailers podrían señalarlo, que ni Excel ni el navegador leen—: se registra en el log y el
archivo se cierra truncado. Quien automatice la descarga debe comparar las filas obtenidas contra
el `total` del listado.

**Orden del CSV: `id` ascendente, que NO es el de la pantalla.** El listado ordena por
`capturadoAt desc` (lo más reciente arriba) y la exportación por `id asc`, es decir por orden de
llegada al servidor, lo más antiguo primero
(`api/src/services/qaExternaPersonasService.ts:136` vs `:164`). Es deliberado: el `id` es la clave
del cursor que permite leer por lotes sin `OFFSET` ni cargar todo en RAM. Si hace falta el orden de
la pantalla, se reordena en Excel por la columna `Capturado (UTC)`.

Las celdas de **texto** que empiezan por `=`, `+`, `-`, `@`, TAB o CR salen precedidas de un
apóstrofo (`'+52 55 1234 5678`): es la marca de "esto es texto" de Excel, que si no evaluaría la
columna Teléfono como fórmula y la dejaría en `#NAME?`. Las columnas numéricas quedan exentas
(`qaExternaPersonasService.ts:218-225`).

**Tope duro de 50 000 filas** por descarga (`MAX_QA_PERSONAS_EXPORT`,
`api/src/services/qaExternaPersonasService.ts:17`, aplicado en el iterador `:159-160`). Si el filtro
da más, el CSV **se corta ahí y aun así responde 200**: como el orden es `id asc`, lo que se pierde
son las capturas **más recientes**. El portal avisa antes de descargar —cuando el total del filtro
supera el tope muestra junto al botón "El CSV se corta en 50,000 filas: de las N personas del filtro
solo se exportarán las más antiguas. Acorta el rango de fechas para descargarlas todas."
(`web/src/app/revision/personas/page.tsx:173-176`)—, pero
quien llame a la API directo no recibe ninguna señal en la respuesta: debe comparar el `total` del
listado contra las filas obtenidas y, si hace falta, descargar por rangos más chicos.

### Navegación del portal de revisión
El portal del revisor tiene **dos** secciones, navegadas como pestañas
(`web/src/app/revision/layout.tsx:17-20`):

| Pestaña | Ruta | Contenido |
|---|---|---|
| Evidencias de campo | `/revision/evidencias` | Tabla con miniaturas + exportación ZIP |
| Registro de personas | `/revision/personas` | Este listado + exportación CSV |

`/revision` ya no es una pantalla: **redirige** en el servidor a `/revision/evidencias`
(`web/src/app/revision/page.tsx:9-11`). El login sigue siendo `/revision/login`.

## Probar conexión (app)
La app hace hoy `GET /api/qa-externa/ingest`. Funciona ya gracias al 405-tras-auth, y `/personas`
tiene el suyo por el mismo motivo (`api/src/routes/qaExternaRouter.ts:198-200`): con key válida, un
método equivocado responde **405**, nunca 401. Cuando el
equipo móvil quiera, puede migrar a `/ping` con un cambio de una línea
(`INGEST_PATH → '/api/qa-externa/ping'` en `src/features/sync/api.ts`, función `probarConexion`).

## Alta de un dispositivo (operador)
```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.staging.yml"
$COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api npm run qa:device:register
```
Imprime la API key **una sola vez** (se guarda solo su hash SHA-256). Cópiala y configúrala en la
app como `Authorization: Bearer <API KEY>`. La **misma** key habilita `/ingest` y `/personas`: el
registro de personas no tiene alta ni credencial aparte, y el `programa` del dispositivo
(`BUFFALO`/`LX`) es el que se estampa en ambas capturas.

Revocar:
```bash
$COMPOSE run --rm -e DEVICE_ID=3 api npm run qa:device:revoke
# o por nombre:
$COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api npm run qa:device:revoke
```

(Opcional) Para HMAC en lugar de SHA-256 plano, define `QA_EXTERNA_KEY_PEPPER` en el `.env` de la
API **y** pásalo al CLI de alta (`-e QA_EXTERNA_KEY_PEPPER=...`) para que el hash coincida.

## ⚠️ Nota TLS para el equipo móvil (BLOQUEA pruebas si se ignora)
Los dos despliegues **difieren**, y de eso depende si la app corre en Expo Go o exige un build EAS:

| Despliegue | URL base | Certificado | Expo Go |
|---|---|---|---|
| **Público (QA)** | `https://qa.aztechcomposites.com` | **Let's Encrypt** (CA pública): `Caddyfile.public:15-19` declara el `email` ACME y el dominio real; `docker-compose.public.yml:215-218` publica `:80` (reto HTTP-01) y `:443`, y `caddy_data` persiste el cert | ✅ **Funciona sin `network-security-config`** ni CA instalada |
| **Staging interno (VPN)** | `https://flotillas.internal:8443` | **`tls internal`** (`Caddyfile:15-16`): CA propia de Caddy, autofirmada | ❌ **Android lo rechaza en Expo Go.** Requiere un **build EAS** con `network-security-config` que confíe la CA |

Exportar la CA de staging para el build EAS:
```bash
$COMPOSE cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
```
Avisar al equipo móvil cuál entorno usarán: contra el público basta Expo Go; contra staging
necesitan el build EAS con la CA.

## Almacenamiento
Las imágenes se guardan content-addressed en una **subcarpeta por programa**:
`qa-externa/<buffalo|lx>/<sha256>.jpg` bajo `/app/uploads` (`QA_EXTERNA_DIR`), persistido en el
bind mount LUKS (`/srv/datos/flotillas/uploads`) en staging y en el volumen `uploads_data` en
público (`api/src/lib/qaExternaStorage.ts:69,82`).

El revisor **no** las descarga por la ruta estática: `/uploads/*` responde **403** al rol
`REVISOR_QA` (`api/src/index.ts:198-204`). Se sirven por la API, con el mismo rol que el listado:
`GET /api/qa-externa-registros/imagenes/:programa/:sha256` y su variante `/thumbnail`
(`api/src/routes/qaExternaRegistrosRouter.ts:110-125`).

El registro de personas **no genera archivos**: vive entero en la tabla `qa_externa_personas`.

## Variables de entorno (todas opcionales, con default)
`QA_EXTERNA_DIR` (`/app/uploads/qa-externa`), `QA_EXTERNA_MAX_FILE_SIZE_MB` (12),
`QA_EXTERNA_MAX_FILES` (5), `QA_EXTERNA_RATE_MAX`/`QA_EXTERNA_RATE_WINDOW_SEC` (60/60),
`QA_EXTERNA_IP_RATE_MAX` (**120**, = 2 × `QA_EXTERNA_RATE_MAX`; si cambias esa, ajústala a mano),
`QA_EXTERNA_KEY_PEPPER` (opcional).

Ninguna hace falta en el `.env` del servidor ni en las plantillas
(`env.staging.plantilla.txt`, `.env.example`, `.env.public.example`): todas traen default en
`api/src/config/env.ts:43-63` y ninguna es un secreto obligatorio, así que `env.ts` no aborta si
faltan. Solo se declaran si se quiere apartar del default.

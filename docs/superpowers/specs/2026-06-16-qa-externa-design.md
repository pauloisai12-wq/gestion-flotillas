# Spec de diseño — Módulo `qa_externa` (ingesta de Evidencia Externa de GeoCampo)

> Estado: **aprobado para escribir plan de implementación** · Fecha: 2026-06-16
> Fuente del contrato: `flotillas-v2-ingest-prompt.md` (contrato HTTP **FIJO** del lado cliente).
> Este spec NO incluye código; es la entrada para `writing-plans`.

---

## 0. Resumen y decisiones

Construir un módulo **aditivo** en la API Node/Express/TS de flotillas-v2 que reciba evidencias de
campo subidas por la app móvil **GeoCampo** (Expo, offline-first, ya desplegada). El contrato del
cliente es fijo: el servidor se adapta a él. El núcleo es **idempotencia** (un reintento no duplica
nada) y **deduplicación de imágenes** por hash de contenido.

Decisiones tomadas con el usuario (2026-06-16):

| Decisión | Elección | Motivo |
|---|---|---|
| "Probar conexión" | **A + red de seguridad B** | `/ping` limpio (estado objetivo) + `GET /ingest`→405 tras auth para que la app ACTUAL siga funcionando sin recompilar |
| TLS / destino móvil | **Ambas rutas** (pública Let's Encrypt + staging `tls internal`) | El equipo móvil elige; se documentan ambas notas de certificado |
| Alcance | **Solo ingesta** | YAGNI: sin UI ni endpoints de listado/revisión (fuera del contrato fijo); se añaden después si hacen falta |
| Hash de API key | **SHA-256** (opcional HMAC con pepper) | Token aleatorio de 256 bits → lookup O(1) por hash único; ya hay precedente (`authService.ts:126`) |
| Tipo `registro_id` | `Int @id @default(autoincrement())` | Convención de TODOS los modelos del repo; la app lo convierte a string |
| `capturado_at` | `DateTime` (TIMESTAMP(3)) tratado como UTC | Consistente con el resto del repo; el cliente manda ISO-8601 con `Z` |
| `width/height` de imagen | Opcionales, vía dep nueva `image-size` (puro JS) | Sin binario nativo → seguro con el build en Docker; si se descarta, quedan nulos |

**Regla dura respetada:** no se toca el SAS ni ningún router/modelo/middleware existente, salvo
adiciones mínimas y seguras (1 línea de montaje en `index.ts`, campos opcionales en `env.ts`, un
campo en `express.d.ts`). El stack es Node/Express/TS — Python es solo el worker (no se toca).

---

## 1. Contexto del código (verificado)

| Aspecto | Evidencia |
|---|---|
| `qa_externa` no existe | grep sin coincidencias en todo el repo |
| Router convención | `camelCaseRouter.ts`, `export default router`, montado en `api/src/index.ts:173-198` |
| Multer ya es dep (v2.1.1) | patrón diskStorage+UUID `documentRouter.ts:11-35`; memoryStorage en `vehicleImportRouter` |
| Validación JPEG | `file-type` v22 ya es dep, magic bytes en `vehicleImportRouter` |
| Errores | `AppError`+atajos y `errorHandler` mapea `ZodError`→400, `P2002`→409, MulterError→400 (`errorHandler.ts:10-150`) |
| Logging | Pino redacta `req.headers.authorization` (`logger.ts:18`) |
| Rate limit | `rateLimit({max,windowSec,keyBuilder,failClosed})` Redis-Lua (`rateLimit.ts:38-69`) |
| SHA-256 precedente | `crypto.createHash('sha256')` en `authService.ts:126` |
| Storage uploads | `/app/uploads` servido gateado por JWT (`index.ts:150-158`); staging persiste en `/srv/datos/flotillas/uploads` (`docker-compose.staging.yml:64`); pública = volumen `uploads_data` |
| Caddy | staging `tls internal`, `reverse_proxy web:3000`, sin timeouts/body-size (`Caddyfile:15-22`); pública Let's Encrypt (`Caddyfile.public`) |
| env | Zod fail-fast (`env.ts`); checks de prod (JWT≥64, bcrypt≥12, no localhost, placeholders) |
| Tipos Express | augmentación en `api/src/types/express.d.ts` (incluida por `tsconfig`) |
| Migraciones | `YYYYMMDDHHMMSS_desc`; última `20260609120000`; `migrate deploy` manual |
| Versiones | zod ^4, multer ^2.1.1, file-type ^22, prisma/@prisma/client ^6.19.3 |

Flujo de red en producción: **móvil → Caddy(:8443) → web:3000 (rewrite Next) → api:3001** (2 saltos
de proxy → `TRUST_PROXY=2` correcto).

---

## 2. Contrato HTTP (FIJO — debe coincidir con la app)

### `POST /api/qa-externa/ingest`
- Header obligatorio `Authorization: Bearer <device_api_key>`.
- `Content-Type: multipart/form-data` (la app no fija el header; RN pone el boundary).
- Campos del form (todos llegan como **string** salvo los archivos):
  - `cliente_registro_id` (UUID v4) — clave de idempotencia.
  - `identificador_app` (string) — etiqueta del dispositivo/instancia.
  - `lat`, `lng` (string decimal → float).
  - `accuracy` (string decimal, **opcional**; se OMITE el campo si es null).
  - `capturado_at` (string ISO-8601 UTC; guardar en UTC).
  - `metadata` (string JSON) → `{"tipo":"lona|reunion|barda|otro","notas":<string|null>}`; parsear JSON; `notas` puede ser null.
  - `imagenes[]` (1..N archivos; hoy siempre 1) — JPEG, mime `image/jpeg`. **Nombre de campo literal `imagenes[]`** (con corchetes).
- **Éxito 2xx (JSON):** `{ "registro_id": <number>, "imagenes": [ {...} ] }`. La app lee `registro_id` y lo guarda como `servidor_id` (string).
- **Auth fallida:** **401** (no 200 con error en el body).
- **Otros errores:** 4xx/5xx con body de error (la app los trata como reintentables).

### `GET /api/qa-externa/ping` (opción A, estado objetivo)
- Con key válida → `200 {"ok":true}`; sin/mala key → **401**.

### `GET /api/qa-externa/ingest` (red de seguridad B, app actual)
- Tras el auth → **405** Method Not Allowed. Sin key → 401; con key → 405 (≠401/403, no-5xx → "Conexión OK").

---

## 3. Arquitectura y unidades (responsabilidad única)

```
POST /api/qa-externa/ingest
  │
  ├─ (mount) app.use('/api/qa-externa', deviceRateLimitIp, deviceAuthMiddleware, qaExternaRouter)
  │        └─ el guard envuelve TODO el router → el auth precede a ingest, ping y al 405
  │
  ├─ deviceAuthMiddleware  ──► req.device = { id, identificador }   (SHA-256 lookup)
  ├─ multer.array('imagenes[]', MAX_FILES)  (memoryStorage)         (buffers en memoria)
  ├─ qaExternaValidator  ──► Zod safeParse de los campos string     (ZodError → errorHandler)
  ├─ qaExternaStorage    ──► sha256 + validar JPEG real + dims + escribir <sha256>.jpg
  └─ qaExternaService    ──► upsert idempotente + dedupe + pivote (transaccional)
                           ──► { registro_id, imagenes:[...] }
```

Unidades nuevas (cada una con un solo propósito):

| Unidad | Archivo | Hace | Depende de |
|---|---|---|---|
| Hash de key (compartido) | `api/src/lib/deviceKeyHash.ts` | `hashDeviceKey(key)`: SHA-256 (o HMAC con pepper). Único punto de verdad para guard + CLIs | crypto, env |
| Guard de dispositivo | `api/src/middlewares/deviceAuthMiddleware.ts` | Autentica Bearer por hash, adjunta `req.device` | prisma, deviceKeyHash, errorHandler, env |
| Validador | `api/src/validators/qaExternaValidator.ts` | Esquema Zod de los campos multipart | zod |
| Storage helper | `api/src/lib/qaExternaStorage.ts` | sha256, validar JPEG (file-type), dims (image-size), escribir/asegurar `<sha256>.jpg` | crypto, file-type, image-size, fs, env |
| Servicio | `api/src/services/qaExternaService.ts` | Upsert idempotente + dedupe + pivote (transacción) | prisma, storage helper |
| Router | `api/src/routes/qaExternaRouter.ts` | Define `POST /ingest`, `GET /ping`, `GET /ingest`(405) | multer, validador, servicio, rateLimit |
| CLI alta | `api/src/scripts/qa-externa-device-register.ts` | Genera key, guarda hash, imprime 1 vez | prisma, crypto, bcrypt no (sha256) |
| CLI revocar | `api/src/scripts/qa-externa-device-revoke.ts` | `activo=false` | prisma |

Adiciones a archivos existentes: `prisma/schema.prisma`, `config/env.ts`, `types/express.d.ts`,
`index.ts` (1 línea de montaje + `mkdir -p` del dir al boot), `package.json` (scripts + dep), `Caddyfile`, `Caddyfile.public`.

---

## 4. Modelo de datos (migración `add_qa_externa`)

4 modelos + 1 enum, con convenciones del repo (`Int` autoincrement, `@@map` snake_case, índices
explícitos). **M2M con tabla pivote** (lo exige el spec: la dedupe por sha256 permite que una imagen
física se vincule a >1 registro).

```
enum QaExternaTipo { lona reunion barda otro }

model QaExternaDispositivo  @@map("qa_externa_dispositivos")
  id            Int      @id @default(autoincrement())
  identificador String                                   // nombre en el alta
  keyHash       String   @unique  @map("key_hash")        // SHA-256 hex (opc. HMAC con pepper)
  activo        Boolean  @default(true)
  lastUsedAt    DateTime? @map("last_used_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt      @map("updated_at")
  registros     QaExternaRegistro[]

model QaExternaRegistro     @@map("qa_externa_registros")   // su id = el registro_id devuelto
  id                Int      @id @default(autoincrement())
  clienteRegistroId String   @unique @map("cliente_registro_id")   // clave de idempotencia
  dispositivoId     Int      @map("dispositivo_id")
  dispositivo       QaExternaDispositivo @relation(fields:[dispositivoId], references:[id])
  identificadorApp  String   @map("identificador_app")
  tipo              QaExternaTipo
  lat               Float
  lng               Float
  accuracy          Float?
  capturadoAt       DateTime @map("capturado_at")                  // UTC
  notas             String?  @db.Text
  metadataRaw       String   @map("metadata_raw") @db.Text         // JSON crudo (trazabilidad)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt      @map("updated_at")
  imagenes          QaExternaRegistroImagen[]
  @@index([dispositivoId])
  @@index([capturadoAt])

model QaExternaImagen       @@map("qa_externa_imagenes")
  id        Int      @id @default(autoincrement())
  sha256    String   @unique                              // hash de contenido (dedupe)
  ruta      String                                        // storage key: qa-externa/<sha256>.jpg
  mime      String                                        // image/jpeg
  bytes     Int
  width     Int?
  height    Int?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")
  registros QaExternaRegistroImagen[]

model QaExternaRegistroImagen  @@map("qa_externa_registro_imagenes")   // pivote M2M
  registroId Int @map("registro_id")
  imagenId   Int @map("imagen_id")
  registro   QaExternaRegistro @relation(fields:[registroId], references:[id], onDelete: Cascade)
  imagen     QaExternaImagen   @relation(fields:[imagenId],   references:[id], onDelete: Cascade)
  createdAt  DateTime @default(now()) @map("created_at")
  @@id([registroId, imagenId])      // PK compuesta → reintento no duplica vínculos
  @@index([imagenId])
```

Migración: `npx prisma migrate dev --name add_qa_externa` (local) → `migrate deploy` (server, vía
one-shot `migrate`). `@unique` en `cliente_registro_id` y en `sha256` (lo exige el spec).

**Nota UTC:** todo el repo usa `DateTime` naïve tratado como UTC; el cliente manda ISO-8601 con `Z`,
así que `new Date(str)` da el instante UTC y Prisma lo guarda sin offset. Alternativa estricta
disponible si se prefiere: `@db.Timestamptz(3)`.

---

## 5. Auth de dispositivo (`deviceAuthMiddleware`)

- Extrae `Authorization: Bearer <key>`. Formato inválido o ausente → **401** (`Unauthorized`).
- `keyHash = hashDeviceKey(key)` mediante un **helper compartido** `api/src/lib/deviceKeyHash.ts`
  (usado también por los CLIs, para que el alta y la verificación hasheen idéntico — si divergen,
  ningún dispositivo autentica). Implementación: `createHash('sha256').update(key).digest('hex')`; si
  `QA_EXTERNA_KEY_PEPPER` está definido, usar `createHmac('sha256', pepper)` (defensa en profundidad).
- `prisma.qaExternaDispositivo.findUnique({ where: { keyHash } })`; si no existe o `!activo` → **401**.
- Adjunta `req.device = { id, identificador }` (NO toca `req.user`). Actualiza `lastUsedAt`
  (no bloqueante, sin esperar el resultado).
- Nunca loguea la key: Pino ya redacta el header; jamás se mete la key en body ni en logs.
- Tipos: añadir `device?: { id: number; identificador: string }` a `Request` en `express.d.ts`.

---

## 6. Endpoint de ingesta — flujo de datos

1. **Rate limit por IP (pre-auth)**, fail-open: `rateLimit({ keyBuilder: req => 'qae:ip:'+ip })`
   para frenar sondeo de keys (la IP es la del extremo VPN/móvil vía `TRUST_PROXY=2`).
2. **deviceAuthMiddleware** → `req.device`.
3. **Rate limit por dispositivo** dentro del router: `keyBuilder: req => 'qae:dev:'+req.device.id`.
4. **multer** `memoryStorage`, `.array('imagenes[]', QA_EXTERNA_MAX_FILES)`,
   `limits:{ fileSize: QA_EXTERNA_MAX_FILE_SIZE_MB*1024*1024 }`. Buffer en memoria para hashear
   antes de escribir (content-addressed). `fileFilter`: extensión `.jpg/.jpeg`.
5. **Validación Zod** (armado manual del body porque multipart entrega strings, patrón
   `documentRouter.ts:56-75`), propagando `ZodError` al `errorHandler` (formato `VALIDATION_ERROR`):
   - `cliente_registro_id` UUID; `lat∈[-90,90]`, `lng∈[-180,180]` (string→float); `accuracy≥0`
     opcional; `capturado_at` ISO-8601→Date; `metadata` JSON→`{tipo∈{lona,reunion,barda,otro}, notas:string|null}`; ≥1 imagen.
6. **Por imagen** (`qaExternaStorage`): `sha256(buffer)`; validar **JPEG real** con `file-type`
   (rechazar si `ext !== 'jpg'`); `image-size` para `width/height` (opcional). Si `<sha256>.jpg` no
   existe en disco → escribir; si existe → no reescribir (mismos bytes, idempotente).
7. **Servicio transaccional** (`prisma.$transaction`):
   - **Upsert registro** por `cliente_registro_id` (last-write-wins en coords/metadata/notas; mismo
     `id`). Carrera de dos POST concurrentes → captura `P2002` → relee y devuelve el existente.
   - **Upsert imagen** por `sha256` (reusar si existe; crear fila si no).
   - **Pivote** `createMany({ data:[{registroId,imagenId}], skipDuplicates:true })` → vínculo
     idempotente.
8. **Respuesta** `200 { registro_id: registro.id, imagenes: [{ id, sha256, bytes, mime, width, height }] }`.

---

## 7. "Probar conexión" (A + red de seguridad B)

El router completo se monta detrás del guard:
`app.use('/api/qa-externa', deviceRateLimitIp, deviceAuthMiddleware, qaExternaRouter)` → **el auth
precede a TODA ruta/método**, lo que neutraliza el footgun de B (un 405 nunca se emite antes del auth).
- `GET /api/qa-externa/ping` → `200 {"ok":true}` con key válida; 401 sin ella.
- `GET /api/qa-externa/ingest` → 405 tras autenticar (sin key → 401; con key → 405 → "Conexión OK").
- Coordinación móvil: cuando quieran, cambian `INGEST_PATH`→`'/api/qa-externa/ping'` en
  `src/features/sync/api.ts` (función `probarConexion`); hasta entonces la red de seguridad B los cubre.

---

## 8. Almacenamiento de imágenes

- Subdirectorio del bind mount existente: **`/app/uploads/qa-externa/<sha256>.jpg`** → persiste en
  staging (`/srv/datos/flotillas/uploads`) y en pública (volumen `uploads_data`) **sin mounts nuevos**.
- `ruta` en BD = `qa-externa/<sha256>.jpg` (relativa a `/app/uploads`).
- Servible para usuarios autenticados vía el `/uploads` estático gateado por JWT (`index.ts:150-158`);
  el dispositivo (device-key) no accede a `/uploads`.
- `mkdir -p` del dir al arrancar (helper de storage), para que exista en dev (donde `/app/uploads`
  no está bind-montado).

---

## 9. CLI de provisión de dispositivos (patrón `bootstrap-admin`/`create-user`)

- `qa-externa-device-register.ts`: valida `DEVICE_NAME`; genera key fuerte
  (`crypto.randomBytes(32).toString('base64url')`); guarda **solo** `hashDeviceKey(key)` (helper
  compartido `lib/deviceKeyHash.ts`, mismo que usa el guard);
  imprime la key **una sola vez** con aviso en mayúsculas ("GUÁRDALA AHORA — NO SE VOLVERÁ A MOSTRAR");
  registra `AuditLog` (action `DEVICE_REGISTER`).
- `qa-externa-device-revoke.ts`: `activo=false` por `id` o `identificador`; `AuditLog`.
- `package.json`: `"qa:device:register": "node dist/scripts/qa-externa-device-register.js"` y `…:revoke`.
- Uso: `docker compose -p flotillas run --rm -e DEVICE_NAME=camara-zona-norte api npm run qa:device:register`.

---

## 10. Despliegue — Caddy / TLS (ambas rutas) + env

### Caddy (timeouts holgados para VPN lenta)
- `Caddyfile` (staging) y `Caddyfile.public`: en el `reverse_proxy web:3000` añadir
  `transport http { read_timeout 300s write_timeout 300s dial_timeout 30s }` y opcional
  `request_body { max_size 16MB }` (algo > el límite de multer). Caddy no cae bytes por defecto;
  el límite real lo impone multer. Verificar end-to-end que el rewrite de Next streamea el body con
  un archivo grande sobre enlace lento.

### Nota TLS para el equipo móvil (documentar en `docs/qa-externa.md`)
- **Pública = Let's Encrypt** (`Caddyfile.public`) → cert de confianza → **Expo Go funciona** sin config.
- **Staging = `tls internal`** (`Caddyfile`) → Android lo **rechaza** en Expo Go → requiere **build EAS**
  con `network-security-config` que confíe la CA de Caddy (exportable con
  `... cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt`).
  **Bloquea pruebas en Expo Go contra staging** → avisar al equipo móvil.

### Variables de entorno nuevas (`env.ts`) — todas opcionales con default
- `QA_EXTERNA_DIR` (def `/app/uploads/qa-externa`)
- `QA_EXTERNA_MAX_FILE_SIZE_MB` (def 12)
- `QA_EXTERNA_MAX_FILES` (def 5)
- `QA_EXTERNA_RATE_MAX` / `QA_EXTERNA_RATE_WINDOW_SEC` (def 60 / 60)
- `QA_EXTERNA_KEY_PEPPER` (opcional)

Al ser todas opcionales con default, **no introducen un nuevo secreto obligatorio en producción** →
`NODE_ENV=production` no falla en `env.ts` (a diferencia del riesgo histórico con Turnstile).

---

## 11. Seguridad / validación / logging (invariantes)

- Auth en **todas** las rutas `qa-externa` (el guard envuelve el router).
- API keys **hasheadas** (SHA-256); nunca en claro/logs/respuestas; generadas con `randomBytes(32)`.
- JPEG validado por **magic bytes** (`file-type`), sin confiar en extensión/mime declarado.
- Límite de tamaño y de número de archivos (multer); rate-limit por IP (pre-auth) y por dispositivo.
- Errores 400/422 con `errorHandler` (sin filtrar secretos/internos en prod).
- No se relaja nada de `env.ts` (JWT≥64, CORS sin localhost, bcrypt≥12, Turnstile intactos).

---

## 12. Pruebas y verificación

**No existe framework de tests en el repo** (CLAUDE.md: no hay `npm test`/vitest/jest). Entregable:
script de humo con `curl` (`docs/qa-externa-smoke.sh`) que cubre los criterios de aceptación:

- POST con Bearer válido + multipart correcto → 1 registro + `{registro_id, imagenes:[...]}` 2xx.
- Reenviar el MISMO `cliente_registro_id` → mismo `registro_id`, sin duplicados.
- Reenviar la MISMA imagen (sha256 repetido) → no re-guarda bytes ni duplica vínculos.
- Sin `Authorization` / key inválida/revocada → 401.
- `tipo` fuera de los 4 valores → 400; `accuracy`/`notas` ausentes → aceptado.
- `capturado_at` se guarda en UTC.
- `GET /ping` con key → 200; `GET /ingest` con key → 405; sin key → 401.

**Portón del CI (correr en `api/` antes de declarar hecho):** `npx prisma validate` ·
`npx prisma generate` · `npx tsc --noEmit` · `npm run build`. No se toca web/worker; el CI debe seguir verde.

---

## 13. Archivos a crear / editar

**Nuevos:**
`api/src/lib/deviceKeyHash.ts` · `api/src/middlewares/deviceAuthMiddleware.ts` ·
`api/src/validators/qaExternaValidator.ts` ·
`api/src/lib/qaExternaStorage.ts` · `api/src/services/qaExternaService.ts` ·
`api/src/routes/qaExternaRouter.ts` · `api/src/scripts/qa-externa-device-register.ts` ·
`api/src/scripts/qa-externa-device-revoke.ts` · migración Prisma `*_add_qa_externa` ·
`docs/qa-externa.md` (contrato + alta de dispositivo + nota TLS) · `docs/qa-externa-smoke.sh`.

**Editados (mínimo):**
`api/prisma/schema.prisma` (+4 modelos/enum) · `api/src/config/env.ts` (+`QA_EXTERNA_*`) ·
`api/src/types/express.d.ts` (+`req.device`) · `api/src/index.ts` (import + 1 línea de montaje
~L198, `mkdir -p` del dir al boot) · `api/package.json` (scripts + dep `image-size`) ·
`Caddyfile` y `Caddyfile.public` (timeouts).

---

## 14. Riesgos / fuera de alcance

- Una sola dependencia nueva: **`image-size`** (puro JS, sin binario nativo → seguro con el build en
  Docker; solo para `width/height` opcionales). Si se descarta, `width/height` quedan nulos.
- No se toca SAS, ni routers/modelos/auth JWT existentes, ni `down`/`prune`.
- Fuera de alcance (no en el contrato): UI de revisión, endpoints de listado, notificaciones,
  workflow de aprobación. Se añaden en una iteración futura si se requieren.
- Pendientes operativos del servidor ya conocidos (ajenos a este módulo): backups y tuning de Postgres.

---

## 15. Criterios de aceptación (del INIT_PROMPT)

- [ ] POST con Bearer válido + multipart correcto crea 1 registro y devuelve `{registro_id, imagenes:[...]}` 2xx.
- [ ] Reenviar el MISMO `cliente_registro_id` (con o sin las mismas imágenes) no crea duplicados y devuelve el mismo `registro_id`.
- [ ] Reenviar la MISMA imagen (sha256 repetido) no re-guarda bytes ni duplica vínculos.
- [ ] Sin `Authorization` o con key inválida/revocada → 401.
- [ ] `accuracy` y `notas` ausentes/nulos se aceptan; `tipo` fuera de los 4 valores se rechaza.
- [ ] `capturado_at` se guarda en UTC correctamente.
- [ ] "Probar conexión" responde OK con key válida y "API key inválida" con key mala.
- [ ] La key nunca aparece en logs ni en la base en claro.
- [ ] Caddy enruta y acepta el tamaño de subida; TLS documentado (pública y staging).

# Plan — Audios de encuestas (`POST /api/v1/encuestas/{idLocal}/audios`) + v4 estricta

## Contexto

La app "Encuestas Okrean" ya sincroniza encuestas por `POST /api/v1/encuestas` (JSON, Bearer por dispositivo, idempotente por `idLocal`). El cliente móvil tiene lista la subida del **audio grabado en cada encuesta** (1..N segmentos por encuesta, uno por petición) y espera este endpoint para encenderse. El contrato del cliente es rígido (códigos de estado, forma del 404, `audio_id`), así que **el contrato manda sobre las convenciones del repo** donde choquen (ver "Desviaciones").

Estado verificado en el repo (rama `main` = `924de93`):
- La **v4 ya está fusionada** (PR #8): `POR_VERSION` en `api/src/routes/encuestasIngestRouter.ts:61-65` despacha 1/3/4. **Pero el catálogo P8 no coincide** con el contrato: `PREFERENCIAS_ELECTORALES_V4` (`api/src/validators/encuestasIngestValidator.ts:70-72`) trae `paola_barrera` y le faltan `paco_nino` y `goyo_castaneda`. P9 (`PARTIDOS_V4`) sí coincide. Las reglas de `*Otro` (1..80 tras trim, obligatorio con `otro`, rechazado con otro código) ya están (`:144-150`, `:258-291`). El canónico/hash no depende de los valores del enum (`api/src/lib/encuestasCanonical.ts:112`), y las golden hashes usan `lalo_ximenez`/`otro` → no cambian.
- No existe detalle de encuesta ni `GET /api/encuestas/:id`; solo lista + CSV (`api/src/routes/encuestasRevisionRouter.ts`). El portal web solo tiene `/revision/encuestas/page.tsx` (lista). Comités tiene el patrón de detalle a calcar (`web/src/app/revision/comites/[id]/page.tsx`, hook `useQaComite` en `web/src/hooks/useQaComites.ts:99-108`, `DataTable onRowClick` en `comites/page.tsx:323`).
- Binarios de qa-externa: `multer.memoryStorage()`, sha256 del buffer (`api/src/lib/qaExternaStorage.ts:84`), archivo en disco **antes** de la transacción, upsert de dedupe + un reintento ante P2002 (`api/src/services/qaExternaService.ts:119-126`). Se sirven a usuarios JWT (cookie httpOnly, same-origin) con `<img src="${API_BASE}/api/...">`; el `/uploads` estático está **prohibido para REVISOR_QA** (`api/src/index.ts:202-215`), así que el audio se sirve por endpoint propio con `sendPrivateFile` (`api/src/lib/privateFileResponse.ts`).
- Envolvente de error del repo: siempre plana `{error:string, code, requestId}`; **no existe** `{"error":{"code":...}}`. Multer → 400 en el `errorHandler` global (nunca 413). `/comites` ya traduce multer a `issues[]` inline (`api/src/routes/qaExternaRouter.ts:361-408`, `uploadComitesConIssues`).
- Gates de CI relevantes: `check-qa-migrations-safe.js` protege `encuestas*` (solo prohíbe DELETE/TRUNCATE/DROP; una migración `CREATE TABLE` pura pasa — **no** usar `DROP TABLE IF EXISTS`). `check-config-references.js` no mira env vars. Las `ENCUESTAS_*` **no** van en ninguna plantilla `.env*` (todas opcionales con default, `env.ts:68-71`); solo en `env.ts` y en la tabla de `docs/encuestas-okrean.md:823-843`.

Decisiones del usuario (24 ago 2026): **v4 estricta** (P8 = exactamente los 8 códigos del contrato; `paola_barrera` solo sigue válida en v3) y **rama nueva `feat/encuestas-audios` desde `main`** (independiente de `feat/qa-externa-comites`, sin archivos en común).

## Desviaciones / decisiones de diseño

1. **404 anidado exacto** `{"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}`, sin `requestId` ni `message` (el cliente distingue por ese código "encuesta desconocida" de "ruta no publicada"). Única envolvente anidada del API: comentario prominente en el router para que nadie la "arregle".
2. **413 para archivo grande** (`LIMIT_FILE_SIZE`, cuerpo plano `{error, code:'PAYLOAD_TOO_LARGE', requestId}`): lo exige el contrato ("rechazo definitivo"). Cualquier otro `MulterError` y toda validación → **422 con `issues[]`** (nunca 400: el cliente lo trata como transitorio y reintentaría para siempre). Se documenta como divergencia deliberada respecto a `/ingest` y `/comites`.
3. **Unicidad**: `@@unique([encuestaId, segmento])` + índice normal en `sha256`; dedup por `(encuesta, segmento, sha256)`. Sin unique en `(encuesta, sha256)` (dos segmentos con bytes iguales son dos filas, como pide la tarea).
4. **Sin columna `dispositivo_id` en la tabla hija**: la regla 1 garantiza que el que sube es el dueño de la encuesta, así que el identificador del dispositivo se deriva de `encuesta.dispositivo.identificador`. Sin nueva back-relation en `EncuestaDispositivo`.
5. **Blob content-addressed global** `<ENCUESTAS_AUDIO_DIR>/<sha256>.m4a` (tmp + `rename`, se omite si ya existe). Sin transcodificar ni validar formato; `mime_declarado` se guarda tal cual.
6. **Duración best-effort** en servidor: parser mínimo ISO-BMFF (`moov/mvhd`, versión 0/1, tamaños de 64 bits, `moov` después de `mdat`) → `duracionMs` nullable. Sin deps nuevas. El navegador la completa con `onLoadedMetadata` si viene null.
7. **Cuota compartida**: misma ruta en el mismo router, mismo cubo `rl:enc:dev:<id>` (60/min) y mismo cubo por IP.
8. **Límite de tamaño**: `ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB` default **50** (contrato, "sugerido"), `.min(1).max(100)`; `memoryStorage` como el resto del repo. Se documenta que el operador puede bajarlo (no hay tope de body en `Caddyfile*`).
9. **Servir audio con `sendPrivateFile` + `Range`** (extensión opcional del helper), no con `res.sendFile` (reabriría por ruta, perdería `O_NOFOLLOW` y metería `Cache-Control: public`).

## Cambios

### A. v4 estricta (prerrequisito)
- `api/src/validators/encuestasIngestValidator.ts:70-72`: `PREFERENCIAS_ELECTORALES_V4 = ['irineo_molina','fernando_huerta','lalo_ximenez','paco_nino','ana_gabriela_delgado','goyo_castaneda','otro','no_sabe_no_contesta']`. No tocar `PREFERENCIAS_ELECTORALES_V3` (`:64-66`), el canónico ni las golden hashes.
- `api/tests/sprint5/encuestas-validator.test.ts:747-756`: reescribir el test "acepta todos los candidatos de v3 en v4" para iterar la constante `PREFERENCIAS_ELECTORALES_V4` importada, + negativo: `paola_barrera` → rechazada en v4 y aceptada en v3.
- Docs: `docs/encuestas-okrean.md` (`#### Catálogos de v4` ~`:226-236`) y `docs/encuestas-okrean-openapi.yaml:503` (enum v4; el de `:488` es v3, no tocar). Una frase: filas v4 ya guardadas con `paola_barrera` (si las hubiera) siguen leyéndose/exportándose; solo un reenvío idéntico daría 422.

### B. Modelo + migración
`api/prisma/schema.prisma` — nuevo modelo + `audios EncuestaAudio[]` en `Encuesta`:
```prisma
model EncuestaAudio {
  id            Int      @id @default(autoincrement())
  encuestaId    Int      @map("encuesta_id")
  segmento      String   @db.VarChar(64)
  sha256        String   @db.Char(64)
  tamanoBytes   Int      @map("tamano_bytes")
  mimeDeclarado String?  @map("mime_declarado") @db.VarChar(120)
  ruta          String
  duracionMs    Int?     @map("duracion_ms")
  recibidoEn    DateTime @default(now()) @map("recibido_en")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  encuesta      Encuesta @relation(fields: [encuestaId], references: [id], onDelete: Cascade)
  @@unique([encuestaId, segmento])
  @@index([sha256])
  @@map("encuestas_audios")
}
```
Migración aditiva `api/prisma/migrations/20260824120000_add_encuestas_audios/migration.sql` (CREATE TABLE + unique + índice + FK; sin DROP).

### C. Config / almacenamiento
- `api/src/config/env.ts` (bloque ENCUESTAS, tras `ENCUESTAS_KEY_PEPPER` `:88`): `ENCUESTAS_AUDIO_DIR: z.string().default('/app/uploads/encuestas-audio')` y `ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50)` (patrón de `:44-46`). Queda bajo `/app/uploads` → lo cubren `uploads_data` (public) y el bind `/srv/datos/flotillas/uploads` (staging); `storage-init` ya hace `chown -R` de la raíz. **No** añadir a plantillas `.env*` ni a compose.
- `api/Dockerfile:~61`: `/app/uploads/encuestas-audio` en el `mkdir -p`. **No** tocar `ensureUploadDirectories()` (es `__dirname`-relativo y fail-closed).
- Nuevo `api/src/lib/encuestasAudioStorage.ts`: `sha256Of(buffer)`, `ensureEncuestasAudioDir()` (best-effort, llamado junto a `ensureQaExternaDir()` en `api/src/index.ts:364-370`), `guardarAudio(buffer, sha256) → ruta relativa` (mkdir lazy, tmp `.<sha>.<uuid>.tmp` + `rename`, no reescribe si existe), `rutaAbsolutaAudio(ruta)` con guard `startsWith(baseDir + sep)` y regex del sha.
- Nuevo `api/src/lib/audioDuration.ts`: `duracionMsIsoBmff(buffer): number | null`.
- `api/src/lib/privateFileResponse.ts`: opción `acceptRanges?: boolean` → `Accept-Ranges: bytes`; con `Range: bytes=a-b` (un solo rango; inválido → 416 + `Content-Range: bytes */size`) responde 206 + `Content-Range` + `Content-Length` y `handle.createReadStream({start, end})`. Flag apagado por defecto → callers actuales intactos. Añadir `Cache-Control … no-transform` en la llamada de audio (audio/* no es comprimible para `compression`, pero se explicita).

### D. Endpoint de ingesta (`api/src/routes/encuestasIngestRouter.ts`)
`POST /:idLocal/audios`, en este orden:
1. `perDeviceLimit` (cubo compartido).
2. `prisma.encuesta.findFirst({ where: { idLocal: req.params.idLocal, dispositivoId: req.encuestaDevice!.id }, select: { id: true } })` **antes** del multipart → si no hay fila: `res.status(404).json({ error: { code: 'ENCUESTA_NO_ENCONTRADA' } })` (cualquier `idLocal`, incluso malformado). Node drena el cuerpo no consumido (`req._dump()`), sin ECONNRESET.
3. `multer({ storage: memoryStorage(), limits: { fileSize: MB*1024*1024, files: 1, fields: 10, fieldSize: 1024, parts: 12 } }).single('audio')` envuelto (copiar `uploadComitesConIssues`, `qaExternaRouter.ts:385-408`): `LIMIT_FILE_SIZE` → 413 plano; otro `MulterError` → 422 `issues[{field: err.field ?? 'audio', message}]`.
4. Zod (`api/src/validators/encuestasAudioValidator.ts`, `zod/v4`): `segmento` trim 1..64 `/^[A-Za-z0-9._-]+$/`; `sha256` `/^[a-f0-9]{64}$/`; `tamano_bytes` string `/^[1-9]\d*$/` → int (≤ 2^31-1); `req.file` obligatorio (`field: 'audio'`). Fallo → `422 {error:'Datos inválidos', code:'VALIDATION_ERROR', issues, requestId}`.
5. `sha256Of(buffer) !== sha256` → 422 `issues[{field:'sha256'}]`; `buffer.length !== tamano_bytes` → 422 `issues[{field:'tamano_bytes'}]`.
6. Servicio `api/src/services/encuestasAudioService.ts` (`guardarAudioEncuestaWithDeps({db, guardarAudio, duracion})` como seam, igual que `ingestEncuestaWithDeps`): escribir blob → `$transaction`: `findUnique({ where: { encuestaId_segmento } })`; no existe → `create` → `{ audioId, created: true }`; mismo sha → `{ created: false }`; sha distinto → `update` (sha, tamaño, ruta, mime, duración) → `{ created: false }`. P2002 → un reintento con transacción nueva. Router: `res.status(created ? 201 : 200).json({ audio_id: String(audioId) })`.
7. `router.get('/:idLocal/audios')` → 405 (red de seguridad como `GET /` `:95-97`).
Sin 409 en esta ruta; 401 solo del middleware de dispositivo; 429 con `Retry-After` lo pone `rateLimit`.

### E. Lectura (JWT + `REVISOR_QA`, `api/src/routes/encuestasRevisionRouter.ts` + `api/src/services/encuestasRevisionService.ts`)
- `encuestaListSelect` (`:144-162`) += `_count: { select: { audios: true } }`; `toDto` (`:248-268`) += `audiosCount` (el front deriva "con/sin audio"; no duplicar `conAudio`).
- Filtro `conAudio`: en `encuestasQuerySchema` **y** `encuestasExportQuerySchema` (`api/src/validators/encuestasRevisionValidator.ts:35-41`) como `z.enum(['true','false']).optional()` → boolean (NO `z.coerce.boolean`); en `EncuestasListQuery` (`:31-37`) y `buildWhere` (`:223-243`, compartido lista/CSV): `audios: { some: {} } | { none: {} }`; pasar por los dos call sites del router (`:39-45`, `:133-137`).
- `GET /:id` → `parseId(req)` (`api/src/lib/http.ts:9-15`) + `ensureFound` (`:29-32`); DTO de lista + `audios: [{ id, segmento, tamanoBytes, duracionMs, mimeDeclarado, recibidoEn, url }]` con `url = /api/encuestas/${id}/audios/${audioId}`; `Cache-Control: private, no-store`.
- `GET|HEAD /:id/audios/:audioId` → fila `{ id: audioId, encuestaId: id }` (select `ruta`, `mimeDeclarado`, `segmento`, `encuesta.idLocal`) → `sendPrivateFile(req, res, abs, { contentType, cacheControl: 'private, max-age=3600, must-revalidate, no-transform', varyCookie: true, acceptRanges: true, downloadName: req.query.download === '1' ? `${idLocal}-${segmento}` : undefined })`; `contentType` = `mimeDeclarado` si empieza por `audio/`, si no `audio/mp4`.
- **Registrar `GET /:id` y `/:id/audios/:audioId` al final del archivo (después de `GET /export.csv`, `:108`)** o `/export.csv` cae en `/:id` y rompe el CSV.

### F. Portal web (`web/`) — leer `node_modules/next/dist/docs/` antes (regla de `web/AGENTS.md`)
- `web/src/hooks/useEncuestas.ts`: `Encuesta` += `audiosCount: number`; `EncuestaQuery`/`buildParams`/`EncuestasCsvParams` += `conAudio?: boolean`; tipo `EncuestaAudio`; `EncuestaDetalle = Encuesta & { audios: EncuestaAudio[] }`; `useEncuesta(id: number | null)` (`queryKey: ['encuesta', id]`, `api.get('/encuestas/' + id)`, `enabled: id !== null`, calcado de `useQaComite`).
- `web/src/app/revision/encuestas/page.tsx`: columna "Audio" (`Badge`: `N segmento(s)` / `Sin audio`), filtro con tres `Button` (Todas / Con audio / Sin audio, `variant` activo/outline, `setPage(1)` al cambiar, como los filtros de fecha `:223-232`), `onRowClick={(row) => router.push('/revision/encuestas/' + row.id)}`, y `conAudio` propagado a la descarga CSV.
- Nueva `web/src/app/revision/encuestas/[id]/page.tsx` (estructura de `comites/[id]/page.tsx`: `'use client'`, `use(params)`, estados inválido/404/cargando): ficha con los campos de la encuesta + card "Audios" con una fila por segmento: `segmento`, duración (`duracionMs` → mm:ss; si null, `onLoadedMetadata` del `<audio>`), tamaño legible, `recibidoEn`, `<audio controls preload="metadata" src={`${API_BASE}${url}`}>` y `<a href={`${API_BASE}${url}?download=1`}>Descargar</a>`. `API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''`.

### G. Tests (vitest, `api/tests/sprint5/`; el CI ya corre `test:sprint5`)
- Env en tests: en un bloque `vi.hoisted` antes de los imports fijar `process.env.ENCUESTAS_AUDIO_DIR` a un dir temporal (`fs.mkdtempSync(os.tmpdir())`) y `ENCUESTAS_AUDIO_MAX_FILE_SIZE_MB='1'` (el default `/app/...` no es escribible en CI; el override permite probar 413 con ~1 MB). Limpiar el dir en `afterAll`.
- `encuestas-audios-http.test.ts` (app como `crearApp()` de `encuestas-ingest-http.test.ts:88-101`, multipart con `.field()`+`.attach()` como `qa-externa-comites-http.test.ts:113-120`, doble Prisma en memoria con `encuesta.findFirst`, `encuestaAudio.findUnique/create/update`, `$transaction`): 404 con código exacto para idLocal desconocido y para encuesta de otro dispositivo (y sin `requestId`); 201 + `audio_id` + archivo en disco; reenvío idéntico → 200 mismo `audio_id`, mtime del blob intacto; sha distinto mismo segmento → 200 mismo id, fila actualizada; sha/tamaño no coinciden → 422 `issues` con `field` correcto; `audio` faltante / `segmento` inválido → 422; > límite → 413; GET → 405; dos segmentos con bytes iguales → dos filas y un solo blob.
- `encuestas-audios-service.test.ts`: reintento P2002 devuelve el id existente.
- `audio-duration.test.ts`: `ftyp`+`moov/mvhd` v0 y v1; `moov` tras `mdat`; buffer basura/AMR (`#!AMR\n`) → null. Reusar el buffer BMFF mínimo como fixture del test HTTP.
- `private-file-range.test.ts` (o dentro del de lectura): 206 con `Content-Range`, 416, HEAD.
- `encuestas-revision-lectura.test.ts`: filtro `conAudio` (`some`/`none` en el where), `GET /:id` (200/404), `/export.csv` sigue funcionando con `GET /:id` registrado, `GET /:id/audios/:audioId` 200/404.
- Tests v4 (§A).

### H. Docs + aviso al equipo móvil
- `docs/encuestas-okrean.md`: subsección en "Cara de DISPOSITIVO" + sección **"Audios de la encuesta"** (partes del multipart, reglas, tabla de códigos 200/201/404/413/422/401/429, ejemplo `curl -F`, callouts `> ` con las decisiones 404-anidado/413/422 como "divergencia deliberada"), `### Tabla encuestas_audios` tras `:822`, dos filas en "Variables de entorno" (`:823-843`), nota en "Despliegue" (`docker-compose.yml` base no persiste `/app/uploads`), corrección catálogo v4, y **nota al equipo móvil**: ruta definitiva `POST https://qa.aztechcomposites.com/api/v1/encuestas/{idLocal}/audios`; **la misma API key de QA sirve** (mismo `encuestasDeviceAuthMiddleware`, misma tabla `encuestas_dispositivos`, cuota 60/min compartida); confirmar el catálogo P8 final (v4 = 8 códigos).
- `docs/encuestas-okrean-openapi.yaml`: path `/api/v1/encuestas/{idLocal}/audios` (multipart, respuestas) antes de `/ping` (`:407`); enum v4 en `:503`. Solo cara de dispositivo (los endpoints del revisor no viven ahí).
- Al terminar: actualizar memoria `encuestas-okrean-module`.

## Verificación
1. `cd api` → `npx prisma validate`, `npx prisma generate`, `npx tsc --noEmit`, `npm run build`, `npm run test:sprint5` y `npm test`, `npm run test:migrations`, `npm run test:config-refs`, `npm audit` (vía `cmd.exe /c` por los binarios nativos de Windows — memoria `wsl-windows-node-modules`; vitest a log).
2. `cd web` → `npx tsc --noEmit`, `npm run lint`, `npm run build`.
3. Smoke manual con `curl` contra el stack dev (`docker-compose.dev.yml`): `npm run encuestas:device:register`; encuesta v4 con `paco_nino` → 201; `curl -F segmento=seg1.m4a -F sha256=… -F tamano_bytes=… -F audio=@seg1.m4a` dos veces (201 → 200 mismo `audio_id`); sha alterado → 422; idLocal ajeno/inexistente → 404 `{"error":{"code":"ENCUESTA_NO_ENCONTRADA"}}`; GET → 405; archivo > límite → 413. Abrir `/revision/encuestas`, filtrar "Con audio", entrar al detalle, reproducir (seek) y descargar.
4. PR a `main` con CI verde; deploy con `deploy-public.sh` (`migrate deploy`); confirmar al equipo móvil con el texto de §H.

## Ejecución
Preferencia del usuario (memoria `exec-prefer-subagent-driven`): Workflow con subagentes por tarea — (A) v4, (B+C) modelo/migración/config/storage/duración/Range, (D) endpoint, (E) lectura, (F) web, (G) tests, (H) docs — y revisión final; subagentes en haiku/opus (no sonnet). Crear antes la rama `feat/encuestas-audios` desde `main`.

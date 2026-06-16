# qa_externa — Ingesta de Evidencia Externa (GeoCampo)

Módulo aditivo que recibe evidencias de campo (una foto JPEG + geo-metadatos) desde la app
móvil GeoCampo. Auth por API key de dispositivo (Bearer), idempotente por UUID de cliente y
con deduplicación de imágenes por sha256.

## Endpoints

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| POST | `/api/qa-externa/ingest` | `Authorization: Bearer <api_key>` | `200 { "registro_id": <number>, "imagenes": [ { "id", "sha256", "bytes", "mime", "width", "height" } ] }` |
| GET | `/api/qa-externa/ping` | Bearer | `200 {"ok":true}` (sin/mala key → 401) |
| GET | `/api/qa-externa/ingest` | Bearer | `405` tras autenticar (red de seguridad para la app actual) |

Campos del `multipart/form-data` del POST: `cliente_registro_id` (UUID), `identificador_app`,
`lat`, `lng`, `accuracy` (opcional), `capturado_at` (ISO-8601 UTC), `metadata`
(`{"tipo":"lona|reunion|barda|otro","notas":<string|null>}`), `imagenes[]` (1..N JPEG; nombre de
campo literal con corchetes). Errores de auth → **401**; validación → **400** `VALIDATION_ERROR`;
otros → 4xx/5xx (reintentables).

### Idempotencia y dedupe
- Reenviar el mismo `cliente_registro_id` actualiza el registro y devuelve el **mismo** `registro_id`.
- Reenviar la misma imagen (mismo sha256) no re-guarda bytes ni duplica el vínculo.

## Probar conexión (app)
La app hace hoy `GET /api/qa-externa/ingest`. Funciona ya gracias al 405-tras-auth. Cuando el
equipo móvil quiera, puede migrar a `/ping` con un cambio de una línea
(`INGEST_PATH → '/api/qa-externa/ping'` en `src/features/sync/api.ts`, función `probarConexion`).

## Alta de un dispositivo (operador)
```bash
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.staging.yml"
$COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api npm run qa:device:register
```
Imprime la API key **una sola vez** (se guarda solo su hash SHA-256). Cópiala y configúrala en la
app como `Authorization: Bearer <API KEY>`.

Revocar:
```bash
$COMPOSE run --rm -e DEVICE_ID=3 api npm run qa:device:revoke
# o por nombre:
$COMPOSE run --rm -e DEVICE_NAME="camara-zona-norte" api npm run qa:device:revoke
```

(Opcional) Para HMAC en lugar de SHA-256 plano, define `QA_EXTERNA_KEY_PEPPER` en el `.env` de la
API **y** pásalo al CLI de alta (`-e QA_EXTERNA_KEY_PEPPER=...`) para que el hash coincida.

## ⚠️ Nota TLS para el equipo móvil (BLOQUEA pruebas si se ignora)
- **Despliegue público** (`Caddyfile.public`, Let's Encrypt, dominio real): certificado de confianza
  → la app funciona en **Expo Go** sin configuración extra.
- **Staging interno** (`Caddyfile`, `tls internal`, `flotillas.internal:8443`): certificado
  autofirmado → **Android lo rechaza en Expo Go**. Se necesita un **build EAS** con
  `network-security-config` que confíe la CA de Caddy. Exportar la CA:
  ```bash
  $COMPOSE cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
  ```
  Avisar al equipo móvil cuál entorno usarán: contra staging necesitan el build EAS con la CA.

## Almacenamiento
Las imágenes se guardan content-addressed como `qa-externa/<sha256>.jpg` bajo `/app/uploads`
(`QA_EXTERNA_DIR`), persistido en el bind mount LUKS (`/srv/datos/flotillas/uploads`) en staging y
en el volumen `uploads_data` en público. Son servibles para usuarios autenticados (JWT) vía
`/uploads/qa-externa/<sha256>.jpg`.

## Variables de entorno (todas opcionales, con default)
`QA_EXTERNA_DIR` (`/app/uploads/qa-externa`), `QA_EXTERNA_MAX_FILE_SIZE_MB` (12),
`QA_EXTERNA_MAX_FILES` (5), `QA_EXTERNA_RATE_MAX`/`QA_EXTERNA_RATE_WINDOW_SEC` (60/60),
`QA_EXTERNA_KEY_PEPPER` (opcional).

# 🛡️ Reporte de Auditoría Pre-Staging — Flotillas v2

**Fecha:** 2026-05-29
**Alcance:** API (Express + Prisma + BullMQ), frontend (Next.js 16 / React 19), consultas SQL, Docker/compose, dependencias y worker Python.
**Metodología:** scouting del repo → 8 dimensiones auditadas en paralelo (multi-agente) → verificación adversarial de cada hallazgo crítico/advertencia para descartar falsos positivos y recalibrar severidad → ronda de completitud (CSRF, cabeceras, dependencias, infra, worker) → verificación manual de los 4 críticos leyendo el código fuente.

## Resumen ejecutivo

| Severidad | Cantidad | Acción |
|-----------|----------|--------|
| 🔴 CRÍTICO | 4 | Arreglar **antes** de exponer staging |
| 🟠 ADVERTENCIA | ~21 | Arreglar **antes** de producción |
| 🔵 MEJORA | ~39 | Refactor / endurecimiento oportunista |

> **Calibración de severidad:** la barra de 🔴 CRÍTICO es *"rompe el servidor o brecha grave alcanzable"*. Dos hallazgos que un agente marcó como crítico (`downloadReport`, `trust proxy`) se reclasificaron a 🟠 ADVERTENCIA tras verificación; se señala explícitamente.

> **Lo bueno (no son hallazgos, son aciertos):** arquitectura sólida con servicios/validadores/`errorHandler` centralizado; `env.ts` aborta el arranque ante config débil; CSRF + Turnstile *fail-closed* en el portal público; Helmet en la API; **sin SQL injection explotable** (Prisma tagged templates + `Prisma.sql`/`join` parametrizados); secretos reales no versionados (`.env` en `.gitignore`).

---

## 🔴 CRÍTICO

### C-1 · Path traversal + escritura de archivo arbitraria en subida de evidencia
- **Archivo:** `api/src/routes/maintenanceRouter.ts:13-21` (y `fileFilter` `:26-33`)
- **Es el único de los 4 routers de subida con este defecto.** Los otros (`documentRouter`, `maintenanceTicketRouter`, `ticketQuoteRouter`) ya usan `crypto.randomUUID()`.

```ts
filename: function(req, file, cb) {
  const uniqueName = Date.now() + '-' + file.originalname;   // ⚠ originalname SIN sanear
  cb(null, uniqueName);
},
// fileFilter valida SOLO file.mimetype (cabecera falsificable), NO la extensión
```

`multer` escribe en `path.join(destination, filename)` y `path.join` resuelve los `..`. Un usuario autenticado (ADMIN/SUPERVISOR_VEHICLES) puede enviar `originalname = "../../uploads/evil.html"` con `Content-Type: image/png` (pasa el filtro) y escribir **fuera** de `uploads/maintenance/`, con extensión arbitraria. Como `/uploads` se sirve estáticamente, el `.html`/`.svg` se renderiza en el mismo origen → XSS almacenado / HTML smuggling.

**Solución:** generar el nombre con `crypto.randomUUID() + ext` (el `originalname` nunca toca el disco) y validar por **extensión**, no por mimetype — replicando `documentRouter.ts:13-18`.

### C-2 · Control de acceso roto sobre documentos sensibles (PII gubernamental)
- **Archivos:** `api/src/routes/documentRouter.ts:37,48` + `api/src/index.ts:132-139`

Cadena de dos fallos:
1. Los `GET /vehicles/:vehicleId/documents` y `GET /documents/:id` **no tienen `roleMiddleware`** (solo `authMiddleware` global), a diferencia de POST/PUT/DELETE que sí restringen a `['ADMIN','SUPERVISOR_VEHICLES']`. Cualquier autenticado —incluido **WORKSHOP (taller externo)** y EXECUTOR— enumera documentos de cualquier vehículo y obtiene el `fileUrl`.
2. `/uploads` se sirve con `express.static` **antes** de cualquier `authMiddleware`, así que el binario (pólizas, tarjetas de circulación, verificaciones, facturas) se descarga **sin token ni rol**.

**Solución:** (a) añadir `roleMiddleware(RoleGroups.VEHICLE_READERS)` a ambos GET; (b) proteger `/uploads` con `authMiddleware` (mínimo aceptable — el despliegue real proxea `/uploads` mismo-origen, así que no rompe el render de `<img>`). El fix ideal a futuro es servir los binarios por endpoints autenticados con validación de propiedad.

### C-3 · Redis sin contraseña + password descartado en el parser de BullMQ
- **Archivos:** `docker-compose.yml:37-49,124` · `api/src/config/queue.ts:11-22` · `worker/main.py:21-23,251`

```ts
// queue.ts — parseRedisUrl SOLO extrae host y port; DESCARTA el password
return { host: parsed.hostname || 'localhost', port: parsed.port ? Number(parsed.port) : 6379 };
```

Redis se levanta sin `--requirepass`, `REDIS_URL` no lleva credenciales, y aunque se añadieran, `queue.ts` y el worker las ignorarían. Cualquier proceso en la red Docker lee/escribe/borra las 4 colas BullMQ. Vector serio: la cola `reports` — el worker Python confía ciegamente en `job.data`, así que un job inyectado dispara reportes falsos, INSERTs en `report_history` y notificaciones a admins. El comentario de `docker-compose.staging.yml:29` admite que ese Redis convive con "las colas RQ del SAS".

**Solución:** habilitar `--requirepass`, propagar `REDIS_PASSWORD` en todas las URLs, y corregir `parseRedisUrl` (queue.ts) + el parseo del worker (`urlparse`) para que usen el password. `ioredis` (rate-limit/CSRF en la API) ya parsea el password de la URL ✅.

### C-4 · Dependencia `xlsx@0.18.5` vulnerable (Prototype Pollution + ReDoS, HIGH, sin fix en npm)
- **Archivos:** `api/package.json:33`, `web/package.json:30` · usada en `api/src/services/vehicleImportService.ts:234`
- **CVEs:** CVE-2023-30533 (Prototype Pollution, GHSA-4r6h-8v6p-xvw6) y CVE-2024-22363 (ReDoS, GHSA-5pgg-2g8v-p4x9). SheetJS retiró el paquete de npm; el parche solo está en su CDN.

`importVehiclesFromBuffer` pasa el buffer subido por el usuario a `XLSX.read()`. El endpoint está autenticado (VEHICLE_WRITERS), pero un `.xlsx` malicioso puede disparar ReDoS (DoS del proceso Node).

**Solución:** `api` → fijar la versión parcheada del CDN oficial (`xlsx@0.20.3`); `web` → **eliminar** la dependencia (no se importa en `web/src`).

---

## 🟠 ADVERTENCIA

> ⬆ **Casi-críticos** (un agente los marcó 🔴; quedan en 🟠 por la rúbrica, pero son prioritarios): **A-1, A-15, A-5b**.

| ID | Hallazgo | Archivo:línea | Solución |
|----|----------|---------------|----------|
| A-1 | `downloadReport` lee JWT de `document.cookie` (httpOnly) → descarga de reportes **100% rota** (siempre 401) | `web/src/hooks/useReports.ts:62-83` | Usar el cliente axios (`withCredentials`) con `responseType:'blob'`; eliminar el header `Authorization` manual; verificar `res.ok` |
| A-2 | GET de vehículos sin `roleMiddleware` (EXECUTOR/WORKSHOP leen toda la flota) | `api/src/routes/vehicleRouter.ts:14,40` | `GET /:id` → `VEHICLE_READERS`; `GET /` → permitir EXECUTOR pero forzar `query.executorId = req.user.id` server-side |
| A-3 | GET de operadores sin `roleMiddleware` (PII expuesta) | `api/src/routes/operatorRouter.ts:10,24` | `requireRole(RoleGroups.VEHICLE_READERS)` en ambos GET |
| A-4 | Sin protección server-side de páginas en Next (gating solo client-side) | `web/src/app/(dashboard)/layout.tsx:22-33` | Crear `web/src/middleware.ts` que valide la cookie en el edge |
| A-5 | CSRF en mutaciones del panel autenticado (endpoints multipart, sin preflight) | `api/src/routes/authRouter.ts:24-30` + routers multipart | Cookie `sameSite:'strict'` y/o middleware que valide `Origin`/`Referer` en métodos no seguros |
| A-5b | `docker-compose.yml` fuerza `NODE_ENV=development` por defecto → portal público **sin captcha**, cookie sin `Secure`, JWT/bcrypt débiles, todo vía ngrok | `docker-compose.yml:69` | No usar `development` como fallback en el compose que se publica; usar el `docker-compose.staging.yml` (production) |
| A-15 | Falta `trust proxy` → rate-limit del portal público colapsa a 1 contador global; CSRF IP-binding inerte; Turnstile recibe IP errónea | `api/src/index.ts:48` | `TRUST_PROXY` configurable en `env.ts` + `app.set('trust proxy', <hops>)` (nº exacto, **no** `true`) |
| A-13 | Handlers async sin `asyncHandler` (Express 4 → request colgado, error no llega al `errorHandler`) | `budgetRouter.ts:20,66,119,174,188,236`; `vehicleNoteRouter.ts:16,34,57,89` | Envolver con `ah()` (`lib/asyncHandler`); validar `NaN` en params |
| A-12 | `closeMonthAndRollover`: 2 escrituras/presupuesto en bucle → riesgo timeout 5s (P2028) | `budgetService.ts:102-135` | `updateMany` fuera del bucle + `{ timeout: 60000 }` en `$transaction` |
| A-11 | N+1 en `getUpcomingServices` (M+2 queries por ficha) | `maintenanceService.ts:46-58` | Un solo `LEFT JOIN LATERAL` (como `getAllPendingServices`) |
| A-16 | `/api/docs` y `/api/docs.json` sin auth en todos los entornos | `api/src/index.ts:145` | Gate por `NODE_ENV !== 'production'` o tras `authMiddleware + ADMIN` |
| A-17 | `GET /api/public/verify` enumera flota + operadores (PII) por mensajes distintos | `api/src/routes/publicRouter.ts:124-135,161` | Unificar mensajes de fallo; cross-check operador↔vehículo antes de revelar datos |
| A-18 | Race `INCR`/`EXPIRE` no atómico (lockout) + fail-open ante error de Redis | `api/src/middlewares/rateLimit.ts:27-46` | `multi().incr().expire().exec()`; fail-closed en `/login` |
| A-19 | Columna inexistente `assignedAmount` → **500 garantizado** en dashboard de presupuesto filtrado | `api/src/services/dashboardService.ts:191-203` | Usar `(vb."baseAmount" + vb."rolloverIn")` + filtrar `vb.kind = 'FUEL'`; tipar la query |
| A-20 | `model` nunca se mapea en la importación → todos los vehículos quedan "SIN DATO" | `api/src/services/vehicleImportService.ts:339` | Añadir alias (`submodelo`/`version`/`linea`) → `model` en `FIELD_MAP` |
| A-21 | El HTML de Next se sirve sin cabeceras de seguridad (CSP, X-Frame-Options, HSTS, nosniff) | `web/next.config.ts:33-57` | `headers()` con `source:'/:path*'` espejando la CSP de Helmet, o cabeceras en el `Caddyfile` |
| A-7 | `.env.staging.example` sugiere la test key always-pass de Turnstile | `.env.staging.example:47` | Dejar `TURNSTILE_SECRET=` vacío; rechazar prefijos `1x0000`/`2x0000`/`3x0000` en `env.ts` |
| A-8 | `env.ts` no detecta placeholders `CAMBIA_ESTO` (JWT placeholder mide 66ch → pasa `min(64)`) | `api/src/config/env.ts:64-83` | Rechazar `JWT_SECRET`/`DATABASE_URL` que matcheen `/CAMBIA_ESTO|genera_con_openssl/i` en producción |
| A-9 | `seed.ts` usa `BCRYPT_ROUNDS=10` + contraseñas triviales sin guard de entorno | `api/prisma/seed.ts:375` | `if (NODE_ENV==='production') throw`; usar `env.BCRYPT_ROUNDS`; contraseñas desde env |
| A-6 | `.gitignore` no cubre `.env.staging`/`.env.production` en la raíz | `.gitignore:5` | `.env.*` + `!.env.example` + `!.env.staging.example` |

---

## 🔵 MEJORA (resumen)

**SQL / Prisma**
- `refreshViewsJob.ts:28`: `$executeRawUnsafe` con interpolación (no explotable, lista constante) → sentencias estáticas o `Prisma.raw` con whitelist.
- **SQL injection: sin hallazgos explotables** ✅.

**Tipado (`as any`, ~53 ocurrencias)** — riesgosos: `$queryRaw<any[]>` (`dashboardService.ts`, ver A-19) y `type Budget = any` (`BudgetTable.tsx:21`). El resto cosmético → definir interfaces compartidas.

**Rendimiento Next.js**
- Polling 60s en 7 hooks de dashboard sobre MVs que cambian cada 15 min (`useDashboardAnalytics.ts:30-85`) → 5 min o eliminar.
- `useReports.ts:35`: polling 10s incondicional → función que pause sin `PROCESSING`.
- `VehicleRankingChart.tsx:22`: doble query top+bottom → `enabled` por vista.
- Split RSC/Client cosmético; faltan `loading.tsx`/Suspense; `next.config.ts` sin `optimizePackageImports:['lucide-react']`.

**N+1 / DB**
- `vehicleService.ts:61`: trae todos los `documents` solo para el semáforo → `take:1` / `groupBy _min`.
- `fuelLoadRouter.ts:38-39`: dos queries en serie → `Promise.all`.
- Falta índice `[vehicleId, loadDate]` en `FuelLoad` (`schema.prisma:478`).

**Errores / calidad**
- `errorHandler.ts:100-106`: filtra `err.code` de Prisma en prod → `code:'DB_ERROR'`.
- `authService.ts:36-47`: enumeración de usuarios por timing → comparar siempre contra hash dummy.
- `vehicleGuard.ts:17`: `console.log` de depuración + respuestas ad-hoc en vez de `AppError`.
- `authService.ts:55,75`: fijar `algorithm:'HS256'` (hardening).
- `vehicleImportService.ts`: `parseInt`/`parseString` sombrean globales; función monolítica ~190 líneas; duplicación `safeCreate`/`safeUpdate`; `findFirst(ADMIN)` en el loop.
- `tickets/[id]/page.tsx:400-517`: `WorkshopActions` = if/else anidados >100 líneas.
- `worker/db.py:124`: imprime `DATABASE_URL` con contraseña (solo modo prueba manual).
- `docker-compose.yml:22-23`: Postgres/Redis publicados al host en modo prod por defecto → bindear a `127.0.0.1`.

---

## Estado de remediación

**Los 4 críticos fueron aplicados el 2026-05-29.** Verificado: `npm run build` (tsc) exit 0 y `py_compile main.py` OK.

| Crítico | Estado | Archivos modificados |
|---------|--------|----------------------|
| C-1 Path traversal (maintenanceRouter) | ✅ aplicado | `api/src/routes/maintenanceRouter.ts` (UUID + validación por extensión) |
| C-2 Acceso a documentos | ✅ aplicado | `api/src/routes/documentRouter.ts` (rol en GET) · `api/src/index.ts` (`authMiddleware` en `/uploads`) |
| C-3 Redis sin password | ✅ aplicado | `api/src/config/queue.ts` · `worker/main.py` · `docker-compose.yml` · `.env.example` · `.env.staging.example` |
| C-4 xlsx vulnerable | ✅ aplicado | `api/package.json`→0.20.3 (CDN) · `web/package.json` (eliminado) · ambos `package-lock.json` regenerados |

### Casi-críticos remediados (2026-05-29)

| ID | Estado | Archivos |
|----|--------|----------|
| A-1 `downloadReport` (descargas rotas) | ✅ aplicado | `web/src/hooks/useReports.ts` (cliente axios + `responseType:'blob'`, sin header manual) |
| A-15 `trust proxy` | ✅ aplicado | `api/src/config/env.ts` (`TRUST_PROXY`) · `api/src/index.ts` (`app.set('trust proxy')`) · `api/src/middlewares/rateLimit.ts` (comentario) · `.env(.staging).example` |
| A-5b `NODE_ENV` sin fallback | ✅ aplicado | `docker-compose.yml:69` (`${NODE_ENV:?…}` + aviso) |

Verificado: `npm run build` (tsc) exit 0 y `npx tsc --noEmit` (web) exit 0.

### ⚠️ Acción manual requerida antes del próximo `docker compose up`
Dos variables son ahora **obligatorias** en tu `.env` real (no versionado); si faltan, el compose **falla rápido** a propósito:
1. **`REDIS_PASSWORD`** (C-3): añade `REDIS_PASSWORD=<contraseña fuerte>` y actualiza `REDIS_URL=redis://:<contraseña fuerte>@redis:6379`. El volumen `redis_data` existente no tiene password; un Redis nuevo con `--requirepass` lo exigirá a todos los clientes (API vía ioredis y worker ya quedaron preparados).
2. **`NODE_ENV`** (A-5b): declara explícitamente `NODE_ENV=development` (local/ngrok privado) o `NODE_ENV=production` (staging/expuesto). Ya no hay fallback silencioso a `development`.

Opcional pero recomendado: **`TRUST_PROXY`** (A-15) — `false` en local; en staging detrás de Caddy+Next usa el nº de saltos (`2`, verificando que Next reenvíe `X-Forwarded-For`).

### Notas
- **C-2b (`/uploads` con `authMiddleware`):** funciona porque el frontend accede a `/uploads` vía proxy mismo-origen de Next (`NEXT_PUBLIC_API_URL=""` en el build). Si en el futuro se sirve el web con un `NEXT_PUBLIC_API_URL` absoluto cross-origin, el render directo de `<img>` a `/uploads` se rompería (la cookie `lax` no viaja cross-site) y habría que migrar a endpoints autenticados con streaming.
- **C-4:** los `node_modules` locales aún tienen la versión vieja (solo se regeneró el lockfile con `--package-lock-only`); el `docker compose build` instalará `xlsx@0.20.3` vía `npm ci`. Para desarrollo local fuera de Docker, correr `npm install` en `api/`.

### Advertencias remediadas (2026-05-29)

Todas las 🟠 ADVERTENCIA aplicadas, salvo dos documentadas como N/A. Verificado: `tsc` API + `tsc --noEmit` web + `py_compile` worker (todos exit 0).

| ID | Estado |
|----|--------|
| A-1 descargas rotas · A-15 trust proxy · A-5b NODE_ENV | ✅ (commit anterior) |
| A-2 GET vehículos sin rol · A-3 GET operadores sin rol | ✅ roleMiddleware + scoping EXECUTOR |
| A-16 /api/docs sin auth en prod | ✅ gate por NODE_ENV |
| A-13 handlers async sin asyncHandler (budget + notes) | ✅ envueltos en `ah()` |
| A-18 rate limiter no atómico + fail-open | ✅ Lua atómico + fail-closed en login |
| A-19 `assignedAmount` → 500 en budget filtrado | ✅ query reescrita sobre vehicle_budgets |
| A-12 rollover N+1 writes + timeout tx | ✅ `updateMany` + timeout 60s |
| A-11 N+1 en getUpcomingServices | ✅ LEFT JOIN LATERAL |
| A-20 `model` no mapeado en import | ✅ alias submodelo/version/linea |
| A-5 CSRF panel | ✅ cookie `sameSite=strict` |
| A-6 `.gitignore` · A-7 test key Turnstile · A-8 placeholders env · A-9 seed guard | ✅ |
| A-21 cabeceras de seguridad del HTML | ✅ nosniff/X-Frame-Options/Referrer/HSTS (CSP diferida) |
| **A-4** gating server-side de páginas | ⏩ **N/A — ya existía** como `web/src/proxy.ts` (Next 16 renombró `middleware`→`proxy`). El hallazgo fue falso negativo. |
| **A-17** `/verify` enumeración/PII | ⏩ **Diferido** — mitigado por A-15; unificar mensajes requiere decisión de producto (el operador necesita ver el motivo de bloqueo). |

### Mejoras aplicadas (selección de bajo riesgo)

✅ `refreshViewsJob` validación de identificador · `errorHandler` no expone `err.code` de Prisma en prod · `authService` timing constante (hash dummy) + algoritmo HS256 fijado · `fuelLoadRouter` `Promise.all` · `queue` tipado `Job` · `vehicleGuard` sin `console.log` debug + logger · `docker-compose` Postgres/Redis a `127.0.0.1` · `worker/db.py` redacta la contraseña · `useReports` polling condicional (solo con reportes `PROCESSING`).

### Mejoras diferidas (refactors grandes / cosméticos, sin valor de seguridad y con riesgo de regresión sin tests)

⏸️ Split de `vehicleImportService.importVehiclesFromBuffer` (~190 líneas) y de `WorkshopActions` (tickets/[id]) · renombrar `parseInt`/`parseString` locales (shadowing) · tipar `BudgetTable`/`DocsStatusChart`/`$queryRaw` (eliminar `any`) · `vehicleService` documents `take:1` (riesgo de alterar el conteo en UI) · intervalos de polling de dashboards · `VehicleRankingChart` `enabled` por vista · `optimizePackageImports` · constantes de umbrales de presupuesto · índice `[vehicleId, loadDate]` en `FuelLoad` (requiere migración) · CSP estricta del HTML con nonce (requiere wiring + prueba en navegador). Recomendadas como limpieza posterior, no bloqueantes para staging.

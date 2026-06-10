# Guía de despliegue — flotillas-v2 → servidor Linux (QA / Staging)

## Contexto

`flotillas-v2` es un sistema de gestión de flotillas (vehículos, combustible, mantenimiento,
presupuesto con rollover mensual, portal público de cargas) compuesto por **4 subproyectos**
orquestados con Docker Compose. El objetivo es **subirlo por primera vez a un servidor Linux**
siguiendo la topología ya documentada en `flotillas-runbook.md`: **servidor de casa
(10.10.0.2), acceso SOLO por WireGuard + Caddy con CA interna, datos en disco cifrado LUKS bajo
`/srv/datos/flotillas`, entorno QA/Staging para 5 revisores, `NODE_ENV=production` endurecido.**

Alcance fijado:
- **Topología:** servidor de casa / staging (como el runbook) — VPN + Caddy interno, no público.
- **Host:** ya preparado (Docker + Compose instalados). La guía NO cubre instalar el SO/Docker;
  se centra en clonar → configurar `.env` → build → migraciones → arranque → verificación.

> El stack real **NO** coincide con `CLAUDE.md` (que describe un backend Python/FastAPI inexistente).
> El backend es **Node/Express/TypeScript**; Python es solo el **worker de reportería**. Esta guía
> refleja el código real verificado, no el `CLAUDE.md`.

---

## 1. Arquitectura desplegada (especificación)

| Servicio (contenedor) | Imagen / build | Puerto interno | Expuesto |
|---|---|---|---|
| `flotillas_postgres` | `postgres:16` | 5432 | No (red interna) |
| `flotillas_redis` | `redis:7-alpine` (`--requirepass`) | 6379 | No (red interna) |
| `flotillas_api` | build `api/` — Node 20, Express, Prisma, BullMQ | 3001 | No (lo proxya `web`) |
| `flotillas_web` | build `web/` — Next.js 16 standalone (React 19) | 3000 | No (detrás de Caddy) |
| `flotillas_worker` | build `worker/` — Python 3.11, WeasyPrint, openpyxl | — | No |
| `flotillas_caddy` | `caddy:2-alpine` (`tls internal`) | 443 (interno) | **Sí, en `10.10.0.2:8443` (VPN; el SAS ocupa 443/80)** |

**Flujo de red:** navegador (VPN) → `https://flotillas.internal:8443` → Caddy `10.10.0.2:8443→443` →
`reverse_proxy web:3000` → Next.js reescribe `/api/*` y `/uploads/*` → `http://api:3001` → Postgres/Redis.
Un solo origen; cookies de sesión marcadas `Secure` (por eso es obligatorio HTTPS aunque sea interno).

**Datos clave del runtime:**
- **Scheduler:** no hay contenedor aparte; los **4 cron jobs BullMQ** viven embebidos en `flotillas_api`.
- **Reportería:** la API solo **encola** en la cola Redis `reports`; el **worker Python** la consume y
  genera PDF (WeasyPrint) + Excel (openpyxl) en `/app/storage/reports`, **directorio compartido** con la
  API por bind mount (sin él, las descargas dan 404).
- **Migraciones:** la API **no migra sola** (`CMD node dist/index.js`). Hay que correr
  `prisma migrate deploy` **manualmente antes** de servir tráfico.
- **Arranque ordenado:** `postgres (healthy)` → `redis (healthy)` → `api (healthy)` → `web` → `caddy`.

Archivos de despliegue: `docker-compose.yml` (base) + `docker-compose.staging.yml` (override) +
`Caddyfile` + `.env` (desde `env.staging.plantilla.txt`).

```bash
# Atajo usado en toda la guía (ejecutar en el servidor).
# `-p flotillas` aísla el proyecto del SAS (red/volúmenes/ciclo de vida; §4).
export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.staging.yml"
```

---

## 2. Datos vitales del proyecto

**Stack y versiones**
- API: Node 20-alpine · Express 4 · TypeScript 5 · Prisma 6.19 · BullMQ 5 · Pino · Helmet · bcrypt · Zod.
- Web: Next.js **16.2.2** · React **19.2.4** · TanStack Query/Table · ECharts · Tailwind 4 · `output: standalone`.
- Worker: Python 3.11 · pandas · openpyxl · WeasyPrint (libpango/cairo/gdk-pixbuf) · psycopg2 · redis · bullmq.
- DB: PostgreSQL **16** (requerido, sin negociación de versión) · 21 modelos Prisma · 6 roles RBAC ·
  **10 migraciones** (abr–may 2026) · **5 vistas materializadas**.

**Layout del repo (monorepo)**
- `api/` backend · `web/` frontend · `worker/` reportería · `prisma/` y `api/prisma/` esquema/migraciones ·
  `storage/reports/` salida de reportes · `docker/` · raíz: compose, Caddyfile, `.env*`, runbook.

**Comandos verificables (los mismos que valida el CI — `.github/workflows/ci.yml`)**
- API: `npm ci && npx prisma generate && npx prisma validate && npx tsc --noEmit && npm run build`
- Web: `npm ci && npm run lint && npx tsc --noEmit && npm run build`
- Worker: `pip install -r requirements.txt && python -m py_compile main.py db.py generate_pdf.py generate_excel.py`
- ⚠ El CI **no** ejecuta tests, ni `migrate deploy`, ni escaneo de seguridad (semgrep). El smoke test real
  es que la imagen `api` **no arranque** si el `.env` es inseguro (fail-fast de `env.ts`).
- ⚠ **No reutilices `node_modules` de otra plataforma** para `next build`: el build local en WSL/Linux
  sobre un `node_modules` instalado en Windows falla con `Cannot find module '…lightningcss.linux-x64-gnu.node'`
  (binario nativo de Tailwind 4). No es un problema de código: el build real ocurre **dentro de Docker**
  (`npm ci` fresco en `node:20-alpine`) y el CI en `ubuntu-latest`, donde el binario correcto sí se instala.

**Cron jobs BullMQ (embebidos en la API)**

| Job | Horario | Qué hace |
|---|---|---|
| `compliance` | 00:01 diario | Bloqueo por documentos vencidos + notifica mantenimientos OVERDUE/WARNING |
| `refresh-views` | cada 15 min | `REFRESH MATERIALIZED VIEW CONCURRENTLY` de las 5 vistas |
| `reports` | 1.º de mes 06:00 | **Solo encola** el reporte mensual (lo procesa el worker Python) |
| `budget-rollover` | 1.º de mes 00:05 | Cierra mes anterior y arrastra remanente (idempotente) |

**Vistas materializadas** (pobladas por `migrate deploy`; primer refresco automático al siguiente tick de 15 min):
`mv_dashboard_summary`, `mv_fuel_monthly_trend`, `mv_vehicle_ranking`, `mv_operator_ranking`, `mv_budget_progress`.

**Cuentas demo del seed** (solo si corres `db seed`, **deshabilitado** con `NODE_ENV=production`): las
contraseñas se toman de `SEED_*_PASSWORD` o, si faltan, se **generan al azar y se imprimen una vez** (sin
literales públicos). El seed es **idempotente** (upsert + guardias de conteo): re-correrlo no duplica.

---

## 3. Requisitos previos del servidor (host con Docker ya listo)

Verificar **antes** de empezar:

- [ ] **Docker Compose ≥ 2.24** (`docker compose version`). El override usa `ports: !reset []`, que requiere 2.24+.
      Si es menor → ver *Gotcha 3* (reemplazar cada `!reset []` por bind a `10.10.0.2`).
- [ ] **Disco LUKS montado** y subdirectorios creados con permisos de escritura para el usuario Docker:
      `/srv/datos/flotillas/{postgres,redis,reports,uploads,caddy/data,caddy/config}`.
- [ ] **WireGuard** activo: el servidor responde en `10.10.0.2`; cada revisor es peer del hub.
- [ ] **DNS interno:** `flotillas.internal → 10.10.0.2` en cada cliente (vía `/etc/hosts` o DNS de la VPN).
- [ ] **Egress a internet:** NO se requiere Cloudflare (Turnstile está **deshabilitado**, §6.1). Solo
      hace falta egress para Sentry **si** lo activas (opcional). *(Ver Gotcha 2.)*
- [ ] **Acceso SSH** por VPN: `ssh <user>@10.10.0.2`.

---

## 4. Variables de entorno (`.env`) — inventario completo

El `.env` vive **en el servidor**, nunca en el repo. Plantilla base: `env.staging.plantilla.txt`.
`env.ts` (`api/src/config/env.ts`) valida todo al arranque y **aborta** (`process.exit(1)`) si algo crítico
falta o es débil. **Build-time** = horneada en la imagen `web` (cambiarla exige `build web`).

### Obligatorias para arrancar

| Variable | Tipo | Regla / validación | Valor sugerido (staging) |
|---|---|---|---|
| `NODE_ENV` | runtime | enum; el compose la **fuerza** (sin fallback) | `production` |
| `POSTGRES_USER` | compose | usuario Postgres | `flotillas_app` |
| `POSTGRES_PASSWORD` | compose | contraseña fuerte (no placeholder) | `openssl rand -base64 24` |
| `POSTGRES_DB` | compose | nombre de BD | `flotillas` |
| `REDIS_PASSWORD` | compose | **obligatoria**; sin ella Redis no arranca (`${REDIS_PASSWORD:?}`) | `openssl rand -base64 24` |
| `JWT_SECRET` | runtime | **≥ 64** chars en prod; sin placeholders | `openssl rand -base64 64` |
| `TURNSTILE_ENABLED` | runtime | `false` en este despliegue (§6.1, VPN-only) | `false` |
| `NEXT_PUBLIC_TURNSTILE_ENABLED` | **build-time** | `false` (apaga el widget del portal) | `false` |

> Con `TURNSTILE_ENABLED=false`, `TURNSTILE_SECRET` y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` **NO** son
> necesarios (déjalos sin definir). Solo se requieren si algún día pones `TURNSTILE_ENABLED=true`.

### Recomendadas / con default (ajustar según entorno)

| Variable | Tipo | Default | Nota para staging |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | runtime | `http://localhost:3000` | **`https://flotillas.internal:8443`** (con el puerto; prod rechaza `localhost`) |
| `TRUST_PROXY` | runtime | `2` (compose) | el compose base ya inyecta `${TRUST_PROXY:-2}` (cadena Caddy→Next→API); el `.env` puede sobreescribirlo |
| `BCRYPT_ROUNDS` | runtime | `12` | dejar `12` (prod exige ≥ 12) |
| `JWT_EXPIRES_IN` | runtime | `8h` | ok |
| `LOG_LEVEL` | runtime | `info` | ok |
| `REPORTS_DIR` | runtime | `/app/storage/reports` | no cambiar (debe coincidir con el worker y el bind mount) |
| `API_PROXY_TARGET` | **build-time** | `http://api:3001` | dejar el default (red Docker) |
| `NEXT_PUBLIC_API_URL` | **build-time** | `""` (relativo) | dejar vacío (proxy same-origin vía Next) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | runtime | vacío | dejar vacío si no usas Sentry (si lo pones, valida formato DSN) |
| `RATE_LIMIT_*` | runtime | 5/60 login, 10/60 público | ok |
| `DATABASE_URL` | runtime (API) | **derivada** de `POSTGRES_*` por el compose (Gotcha 1, ya resuelto) | definir solo si BD externa; password literal |
| `REDIS_URL` | runtime (API) | **derivada** de `REDIS_PASSWORD` por el compose | definir solo si Redis externo; password literal |

> Plantilla lista para copiar a `.env`: **`env.staging.plantilla.txt`** (en la raíz del repo).

---

## 5. Pre-flight: bloqueadores verificados que impiden el arranque

> La auditoría de seguridad de mayo 2026 (4 críticos + ~21 advertencias) figura **remediada en código al
> 2026-05-29**. Lo que queda son **puertas de configuración operacional** (el `.env`) y algunas trampas
> de documentación. Todos los puntos abajo fueron confirmados leyendo el código.

**Puertas de `env.ts` en `NODE_ENV=production`** (cualquiera aborta el contenedor `api`):
`JWT_SECRET` < 64 · `TURNSTILE_SECRET` ausente **solo si** `TURNSTILE_ENABLED=true` (en este despliegue
es `false`, así que no aplica) · `CORS_ALLOWED_ORIGINS` con `localhost` · `BCRYPT_ROUNDS` < 12 ·
placeholders (`CAMBIA_ESTO|genera_con_openssl|tu_password|tu_usuario|tu_base_de_datos`) en
`JWT_SECRET`/`DATABASE_URL`/`REDIS_URL` · `SENTRY_DSN` con formato inválido (déjalo vacío si no lo usas).
*(evidencia: `api/src/config/env.ts`)*

**Gotcha 1 — `DATABASE_URL` / `REDIS_URL` (RESUELTO en el repo).**
`docker-compose.yml` ahora las **deriva** de `POSTGRES_*`/`REDIS_PASSWORD` con
`${DATABASE_URL:-…}` / `${REDIS_URL:-…}` (mismo patrón que el `worker-python`). Basta con definir
`POSTGRES_*` y `REDIS_PASSWORD`. Defínelas **explícitas** en el `.env` solo si apuntas a una BD/Redis
**externos** (entonces esas ganan; password **literal**, el `.env` no interpola `${...}` entre sus líneas).

**Gotcha 2 — Turnstile DESHABILITADO en este despliegue (§6.1).**
Sistema VPN-only con 5 usuarios de confianza → no se usa CAPTCHA externo (cero dependencia de Cloudflare).
El flag `TURNSTILE_ENABLED=false` (API) + `NEXT_PUBLIC_TURNSTILE_ENABLED=false` (web build-time) apaga el
captcha de punta a punta: `env.ts` **no exige** `TURNSTILE_SECRET`, el portal **no** renderiza el widget y
el backend **no** valida token. La defensa de fuerza bruta la mantiene el **rate-limit de login** (no se
relaja). Si algún día quieres reactivarlo, pon ambos flags en `true` y provee `TURNSTILE_SECRET` +
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` REALES de Cloudflare (las test keys `1x/2x/3x0000…` se rechazan); el site
key es **build-time** (cambiarlo exige `build web`).

**Gotcha 3 — Compose < 2.24 no entiende `!reset []`.**
Si `docker compose version` < 2.24, reemplazar cada `ports: !reset []` del override por un bind a la VPN, p.ej.
`- "10.10.0.2:5432:5432"`. *(comentado en `docker-compose.staging.yml:17-19`)*

**Gotcha 4 — `TRUST_PROXY` (RESUELTO en el repo).**
El compose base ahora inyecta `TRUST_PROXY: ${TRUST_PROXY:-2}` (cadena Caddy→Next→API = 2 saltos), así que
`req.ip` recupera la IP real del cliente sin acción manual (rate-limit / CSRF-por-IP / `remoteip` de Turnstile).
El `.env` puede sobreescribirlo. *(env.ts:36, api/src/index.ts:56-60)*

**Gotcha 5 — Migraciones automáticas (RESUELTO en el repo).**
La imagen de la API arranca con `node dist/index.js` (no migra sola), pero el override de staging añade un
servicio one-shot **`migrate`** que corre `prisma migrate deploy` (idempotente, puebla las 5 vistas) y del que
**dependen** `api` y `worker` (`service_completed_successfully`). Con `./deploy.sh` o `up -d` el esquema se
aplica **antes** de servir tráfico; servir sin esquema es imposible. Ya no es un paso manual.

**Gotcha 6 — `db seed` opcional (ahora idempotente, sin contraseñas públicas).**
Solo para demo/QA y **deshabilitado** con `NODE_ENV=production`. Es **idempotente** (re-correrlo no duplica)
y las contraseñas demo se leen de `SEED_*_PASSWORD`; si faltan, genera aleatorias y las imprime **una vez**.
Para sembrar QA: `$COMPOSE run --rm -e NODE_ENV=development api npx prisma db seed`.

---

## 6. Procedimiento de despliegue (paso a paso)

> **Atajo:** tras preparar el disco (paso 1) y el `.env` (paso 2), **`./deploy.sh`** ejecuta los pasos 3–7
> (verifica la versión de Compose, build, dependencias healthy, migraciones automáticas y smoke test).
> Abajo queda el detalle manual equivalente.

```bash
# 1) Preparar disco y código (en el servidor)
sudo mkdir -p /srv/datos/flotillas/{postgres,redis,reports,uploads,caddy/data,caddy/config}
git clone <repo-flotillas-v2> /srv/datos/flotillas/app
cd /srv/datos/flotillas/app

# 2) Configurar el .env (ver §4 y §5). Generar secretos reales:
cp env.staging.plantilla.txt .env
#   - openssl rand -base64 64   → JWT_SECRET
#   - openssl rand -base64 24   → POSTGRES_PASSWORD y REDIS_PASSWORD
#   - DATABASE_URL/REDIS_URL: OPCIONALES (las deriva el compose); solo si BD/Redis externos (Gotcha 1)
#   - Turnstile DESHABILITADO: TURNSTILE_ENABLED=false + NEXT_PUBLIC_TURNSTILE_ENABLED=false (Gotcha 2)
#   - CORS_ALLOWED_ORIGINS=https://flotillas.internal:8443 ; TRUST_PROXY=2 (default en compose) ; NODE_ENV=production
#   - reemplaza TODOS los CAMBIA_ESTO_* (deploy.sh aborta si queda alguno)
nano .env
chmod 600 .env

export COMPOSE="docker compose -p flotillas -f docker-compose.yml -f docker-compose.staging.yml"

# 3) (si Compose < 2.24) aplicar el fallback de puertos del Gotcha 3 antes de continuar
docker compose version

# 4) Build de imágenes (api/web/worker). OJO: las NEXT_PUBLIC_* (incl. TURNSTILE_ENABLED) son build-time.
$COMPOSE build

# 5) Levantar el stack. El servicio one-shot `migrate` aplica el esquema (21 tablas
#    + puebla las 5 vistas) ANTES de que arranquen api/worker — automático (Gotcha 5).
$COMPOSE up -d --wait

# 6) Crear el primer ADMIN (necesario para iniciar sesión con datos REALES).
#    Idempotente; no usa el seed demo. ADMIN_PASSWORD >= 12 chars.
$COMPOSE run --rm -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='claveFuerte' api npm run bootstrap:admin

# 6b) (SOLO QA, opcional, BD vacía) datos demo. Deshabilitado en NODE_ENV=production;
#     córrelo en modo development. NO usar con datos reales. Ver Gotcha 6.
# $COMPOSE run --rm -e NODE_ENV=development api npx prisma db seed

# 7) Estado del stack
$COMPOSE ps

# 8) Exportar la CA interna de Caddy para distribuir a los 5 revisores
$COMPOSE cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
```

---

## 7. Verificación post-deploy (smoke tests)

```bash
$COMPOSE ps                                                   # todos healthy
$COMPOSE logs --tail=50 api                                   # sin "Configuración inválida"/process.exit
$COMPOSE exec api wget -qO- http://127.0.0.1:3001/api/health  # {"status":"ok"}  (503 = pg/redis caído)
```
- Desde un cliente con VPN + CA confiada: abrir **`https://flotillas.internal:8443`**, login con una cuenta,
  confirmar que el **dashboard no está vacío** (vistas pobladas) y que una **descarga de reporte** funciona
  (valida el bind mount compartido API↔worker).
- Si el dashboard sale vacío los primeros 15 min: forzar el refresco de las 5 vistas materializadas
  (`$COMPOSE exec postgres psql -U flotillas_app -d flotillas -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_summary;'` … etc.).
- Probar generar/encolar un reporte y ver `$COMPOSE logs -f worker-python` procesándolo.

---

## 8. Operación, diagnóstico y backups

```bash
$COMPOSE logs -f <servicio>        # api | web | worker-python | postgres | redis | caddy
$COMPOSE restart api               # reiniciar un servicio
$COMPOSE down                      # bajar el stack (sin borrar datos)
```
- `restart: unless-stopped` re-levanta los contenedores tras reiniciar Docker. Tras desbloqueo LUKS, una
  unit systemd con `... up -d` es opcional (bajo esfuerzo) — el host ya tiene Docker.
- **Cambiar una `NEXT_PUBLIC_*` o `API_PROXY_TARGET` exige `$COMPOSE build web`** (son build-time).
- **Backups** (sumar a la rutina cifrada con `age`): `pg_dump` de la BD + respaldar `reports/` y `uploads/`.
- Para 5 usuarios bastan healthchecks + `ps`/`logs` (+ Sentry opt-in). No montar Prometheus/Grafana.

---

## 9. Checklist Go / No-Go

**No-Go si falta cualquiera (bloquea el arranque):**
- [ ] `NODE_ENV=production` en `.env`.
- [ ] `JWT_SECRET` real ≥ 64 chars (`openssl rand -base64 64`), sin placeholders.
- [ ] `POSTGRES_PASSWORD` y `REDIS_PASSWORD` fuertes; `REDIS_PASSWORD` presente.
- [ ] `DATABASE_URL`/`REDIS_URL`: se **derivan** del compose; explícitas solo si BD/Redis externos (Gotcha 1).
- [ ] `TURNSTILE_ENABLED=false` y `NEXT_PUBLIC_TURNSTILE_ENABLED=false` (captcha apagado, §6.1/Gotcha 2).
- [ ] `CORS_ALLOWED_ORIGINS=https://flotillas.internal:8443` (con el puerto, sin `localhost`).
- [ ] `BCRYPT_ROUNDS` ≥ 12 (o vacío → default 12).
- [ ] Sin placeholders `CAMBIA_ESTO_*` en el `.env` (deploy.sh y env.ts lo verifican).
- [ ] Migraciones: las aplica el servicio one-shot `migrate` en el `up -d` (Gotcha 5, automático).
- [ ] Docker Compose ≥ 2.24 **o** fallback de puertos aplicado (Gotcha 3; deploy.sh lo verifica).
- [ ] `/srv/datos/flotillas/*` existe con permisos correctos (disco LUKS montado).

**Recomendado antes de invitar revisores:**
- [ ] `TRUST_PROXY` = `2` (ya por defecto en el compose; Gotcha 4).
- [ ] CA interna de Caddy distribuida/confiada en los 5 clientes; DNS `flotillas.internal`.
- [ ] Si se usó `db seed`: contraseñas demo desde `SEED_*_PASSWORD`, o las generadas guardadas.
- [ ] Backup inicial probado (dump + restore).

---

## Archivos clave (referencia)

- Validación de entorno (fuente de verdad de los bloqueadores): `api/src/config/env.ts:12-114`
- Orquestación base / override / dev: `docker-compose.yml`, `docker-compose.staging.yml`, `docker-compose.dev.yml`
- Reverse proxy interno: `Caddyfile`
- Rewrites/proxy y `output: standalone` del front: `web/next.config.ts:5-29`
- Runbook operativo previo (despliegue, migraciones, jobs, troubleshooting): `flotillas-runbook.md`
- Esquema y migraciones: `api/prisma/schema.prisma`, `api/prisma/migrations/` (10), `api/prisma/seed.ts`
- Worker de reportería y deps de sistema: `worker/main.py`, `worker/Dockerfile`, `worker/requirements.txt`
- CI (lo que se valida antes de mergear): `.github/workflows/ci.yml`

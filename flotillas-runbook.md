# Runbook — flotillas-v2 en el servidor de casa (QA/Staging)

> Runbook operativo del despliegue de **flotillas-v2** como **segundo sistema** en
> el servidor `toshinori_nmh` (10.10.0.2), siguiendo el patrón §9 del documento
> base del servidor de casa. Entorno **QA/Staging** para un equipo de **5 revisores**,
> tráfico mínimo, acceso **solo vía WireGuard + Caddy interno**.
>
> **Fuera de alcance (ignorado del doc base):** todo lo relativo al iPad `keigo`,
> el proyecto SAS (padrón, `sas_app`, FastAPI, RQ, hash-chain), y la operación de
> hardware del servidor (LUKS/initramfs, CR2032, UPS). Solo se reutiliza la
> **plataforma** (Docker, disco cifrado, Redis, Caddy, VPN), no los servicios del SAS.

---

## 1. Arquitectura desplegada

| Servicio (contenedor) | Imagen | Puerto interno | Expuesto |
|---|---|---|---|
| `flotillas_postgres` | postgres:16 | 5432 | No (red interna) |
| `flotillas_redis` | redis:7-alpine | 6379 | No (red interna) |
| `flotillas_api` | build `api/` (Node 20) | 3001 | No (proxiado por web) |
| `flotillas_web` | build `web/` (Next standalone) | 3000 | No (detrás de Caddy) |
| `flotillas_worker` | build `worker/` (Python) | — | No |
| `flotillas_caddy` | caddy:2-alpine | 80/443 | **Sí, solo en 10.10.0.2 (VPN)** |

- **Datos persistentes (disco cifrado LUKS):** `/srv/datos/flotillas/{postgres,redis,reports,uploads,caddy}`.
- **Scheduler:** no hay contenedor aparte; los 4 cron jobs BullMQ viven embebidos en `flotillas_api` (`api/src/jobs/index.ts`).
- **Reportería:** la API solo **encola** en la cola `reports`; el worker Python la procesa (PDF WeasyPrint + Excel openpyxl).

Archivos de despliegue: `docker-compose.yml` + `docker-compose.staging.yml` + `Caddyfile` + `.env` (desde `.env.staging.example`).

```bash
# Atajo usado en todo este runbook (ejecutar en el servidor):
export COMPOSE="docker compose -f docker-compose.yml -f docker-compose.staging.yml"
```

---

## 2. Acceso (VPN + Caddy)

1. **WireGuard:** cada revisor es un peer en el hub Vultr (10.10.0.1), con IP en `10.10.0.0/24`. El servidor de casa sigue siendo `10.10.0.2`. *(El iPad `keigo` no participa.)*
2. **Resolución de nombre:** en cada cliente, `flotillas.internal → 10.10.0.2` (vía `/etc/hosts` o el DNS de la VPN).
3. **HTTPS / CA interna:** Caddy usa `tls internal`. Distribuir la raíz a los revisores (o aceptar la advertencia del navegador una vez):
   ```bash
   $COMPOSE cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
   ```
4. **URL de acceso:** `https://flotillas.internal`.
5. **Administración:** SSH al servidor por VPN — `ssh toshinori_nmh@10.10.0.2`.

---

## 3. Secretos / variables de entorno

Viven en `.env` **en el servidor** (nunca en el repo). Plantilla: `.env.staging.example`.
Con `NODE_ENV=production`, `env.ts` **aborta el arranque** si:

- `JWT_SECRET` < 64 caracteres → genéralo con `openssl rand -base64 64`.
- falta `TURNSTILE_SECRET` → es **obligatorio en producción**. Usa el **secret real** de
  Cloudflare Turnstile (las *test keys* always-pass `1x/2x/3x0000…` se **rechazan** en prod —
  no las uses). Déjalo vacío **solo** en `development`. Empareja con `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  (build-time del web).
- `CORS_ALLOWED_ORIGINS` contiene `localhost` → debe ser `https://flotillas.internal`.
- `BCRYPT_ROUNDS` < 12.
- `JWT_SECRET`/`DATABASE_URL`/`REDIS_URL` contienen un valor *placeholder* de la plantilla
  (`CAMBIA_ESTO`, `tu_password`, `genera_con_openssl`, …) → reemplázalos por los reales.
- `SENTRY_DSN` con formato inválido (déjalo vacío si no usas Sentry).

Notas:
- **`DATABASE_URL` / `REDIS_URL`**: el `docker-compose.yml` ahora las **deriva** de
  `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` y `REDIS_PASSWORD` (mismo patrón que el worker),
  así que basta con definir esas. Defínelas explícitas en `.env` **solo** si apuntas a una BD/Redis
  externos. Si las escribes a mano, la contraseña va **literal** en la URL (el `.env` no interpola
  `${...}` entre sus propias líneas).
- **`TRUST_PROXY`**: el `docker-compose.yml` ya lo inyecta (`${TRUST_PROXY:-2}`, cadena Caddy→Next→API),
  así que `req.ip` recupera la IP real del cliente sin acción manual (rate-limit / CSRF-por-IP /
  `remoteip` de Turnstile). El `.env` puede sobreescribirlo; **nunca** uses `true` (permite spoofing).

---

## 4. Despliegue inicial

```bash
# [SERVIDOR] preparar disco y código
sudo mkdir -p /srv/datos/flotillas/{postgres,redis,reports,uploads,caddy/data,caddy/config}
git clone <repo-flotillas-v2> /srv/datos/flotillas/app
cd /srv/datos/flotillas/app
cp .env.staging.example .env && nano .env        # reemplaza cada CAMBIA_ESTO_* (POSTGRES_PASSWORD, JWT_SECRET, …)
chmod 600 .env

# Un solo comando (build + migraciones automáticas + smoke test):
./deploy.sh

# --- o, manualmente: ---
export COMPOSE="docker compose -f docker-compose.yml -f docker-compose.staging.yml"
$COMPOSE build
# El servicio one-shot `migrate` aplica `prisma migrate deploy` (tablas + 5 vistas)
# ANTES de que arranquen api/worker; servir sin esquema es imposible.
$COMPOSE up -d --wait
$COMPOSE ps

# (opcional, solo BD vacía) datos demo — el seed está deshabilitado en producción:
# $COMPOSE run --rm -e NODE_ENV=development api npx prisma db seed
```

---

## 5. Migraciones Prisma

- La imagen de la API arranca con `node dist/index.js` (no migra sola), pero el override de staging añade un
  servicio one-shot **`migrate`** que corre `prisma migrate deploy` y del que **dependen** `api` y `worker`
  (`service_completed_successfully`). Con `./deploy.sh` o `$COMPOSE up -d` el esquema se aplica
  **automáticamente** antes de servir tráfico. `migrate deploy` es idempotente: re-ejecutar `up` es seguro.
- Para aplicarlas a mano (p.ej. tras editar migraciones):
  ```bash
  $COMPOSE run --rm migrate        # o:  $COMPOSE run --rm api npx prisma migrate deploy
  ```
  Usar **`migrate deploy`** (no interactivo), **nunca `migrate dev`** en este entorno.
- La migración `20260421050000_add_materialized_views_v2` crea **y puebla** las 5 vistas materializadas y sus índices únicos; no requiere acción manual.

---

## 6. Datos semilla y cuentas

- El seed (`prisma db seed`) es **solo para demo/QA** y está **deshabilitado** con `NODE_ENV=production`.
  Para sembrar una BD de QA:
  ```bash
  $COMPOSE run --rm -e NODE_ENV=development api npx prisma db seed
  ```
- Es **idempotente**: las entidades con clave única usan `upsert` y las demás (documentos, cargas,
  asignaciones, notas, catálogo) tienen guardia por conteo. Re-correrlo **no duplica**.
- **No hay contraseñas públicas hardcodeadas**: las cuentas demo toman su contraseña de las variables
  `SEED_*_PASSWORD`. Si no las defines, el seed **genera una aleatoria por rol y la imprime una sola vez**
  al final — guárdala.

| Cuenta | Contraseña | Rol |
|---|---|---|
| admin@flotillas.com | `SEED_ADMIN_PASSWORD` (o generada) | ADMIN |
| vehiculos@flotillas.com | `SEED_SUPER_PASSWORD` (o generada) | SUPERVISOR_VEHICLES |
| gasolina@flotillas.com | `SEED_SUPER_PASSWORD` (o generada) | SUPERVISOR_FUEL |
| mantenimiento@flotillas.com | `SEED_SUPER_PASSWORD` (o generada) | SUPERVISOR_MAINTENANCE |
| ejecutor1@ / ejecutor2@flotillas.com | `SEED_EXECUTOR_PASSWORD` (o generada) | EXECUTOR |
| taller1@ / taller2@ / taller3@flotillas.com | `SEED_WORKSHOP_PASSWORD` (o generada) | WORKSHOP |

---

## 7. Vistas materializadas

- 5 vistas: `mv_dashboard_summary`, `mv_fuel_monthly_trend`, `mv_vehicle_ranking`, `mv_operator_ranking`, `mv_budget_progress`.
- Quedan **pobladas por `migrate deploy`** → el dashboard funciona desde el primer arranque.
- El job BullMQ `refresh-views` hace `REFRESH ... CONCURRENTLY` **cada 15 min**. El primer refresco automático ocurre en el siguiente tick (no al boot).
- Forzar refresco inmediato (p.ej. tras un seed grande):
  ```bash
  $COMPOSE exec postgres psql -U flotillas_app -d flotillas \
    -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_summary;' \
    -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fuel_monthly_trend;' \
    -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_vehicle_ranking;' \
    -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_operator_ranking;' \
    -c 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_budget_progress;'
  ```

---

## 8. Cron jobs (BullMQ, embebidos en la API)

| Job | Horario | Qué hace |
|---|---|---|
| `compliance` | 00:01 diario | Bloqueo por documentos vencidos + notifica mantenimientos OVERDUE/WARNING |
| `refresh-views` | cada 15 min | `REFRESH MATERIALIZED VIEW CONCURRENTLY` de las 5 vistas |
| `reports` | 1.º de mes 06:00 | **Solo encola** el reporte mensual (lo procesa el worker Python) |
| `budget-rollover` | 1.º de mes 00:05 | Cierra mes anterior y arrastra remanente (idempotente) |

---

## 9. Operación y diagnóstico

```bash
$COMPOSE ps                                              # estado/health
$COMPOSE logs -f api                                     # logs de un servicio
$COMPOSE exec api wget -qO- http://127.0.0.1:3001/api/health   # {"status":"ok"} | 503 degraded
$COMPOSE restart api                                     # reiniciar un servicio
$COMPOSE down                                            # bajar el stack (sin borrar datos)
```

- `restart: unless-stopped` re-levanta los contenedores tras reinicio del Docker. Para arranque tras desbloqueo LUKS, una systemd unit con `docker compose ... up -d` es opcional (bajo esfuerzo).
- Monitoreo: para 5 usuarios **bastan** los healthchecks + `docker compose ps/logs` (y Sentry opt-in si se activa). **No** montar Prometheus/Grafana dedicado.

---

## 10. Backups y restauración

- Sumar a la rutina diaria cifrada con `age` del servidor (`/srv/datos/backups`):
  ```bash
  # dump lógico de la BD
  $COMPOSE exec -T postgres pg_dump -U flotillas_app -d flotillas | age -r <pubkey> > flotillas-$(date +%F).sql.age
  # + respaldar /srv/datos/flotillas/reports y /srv/datos/flotillas/uploads
  ```
- **Restauración** (probar periódicamente):
  ```bash
  age -d -i <clave-privada> flotillas-AAAA-MM-DD.sql.age | $COMPOSE exec -T postgres psql -U flotillas_app -d flotillas
  ```

---

## 11. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| El contenedor `api` no arranca | `env.ts` abortó (config débil) | Revisar `JWT_SECRET≥64`, `TURNSTILE_SECRET`, `CORS` sin localhost, `BCRYPT_ROUNDS≥12`, `SENTRY_DSN` válido o vacío |
| `/api/health` devuelve 503 | Postgres o Redis caídos | `$COMPOSE ps`; revisar logs de `postgres`/`redis` |
| Dashboard vacío | Vistas no pobladas | Confirmar que `migrate deploy` corrió; forzar refresco (§7) |
| Reportes no descargan | La API no ve `storage/reports` | Verificar el bind `/srv/datos/flotillas/reports:/app/storage/reports` en `api` (incluido en el override) |
| Login no persiste sesión | Cookie `Secure` rechazada / proxy | Confirmar acceso por `https://` (Caddy) y revisar `trust proxy` / emisión de cookie detrás de Caddy+Next |
| Cambiar `NEXT_PUBLIC_*` no surte efecto | Son build-time | Reconstruir la imagen web (`$COMPOSE build web`) |
| `!reset []` no reconocido | Docker Compose < 2.24 | Reemplazar por bind a la IP VPN (ver comentario en el override) |

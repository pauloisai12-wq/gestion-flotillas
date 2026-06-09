# flotillas-v2 — Despliegue staging a prueba de gotchas ✅ LISTO

**Rama:** `deploy/staging-ready` · **Estado:** completo, CI verde (donde es ejecutable), compose validado.

Convertí los "gotchas" del despliegue (pasos manuales que el operador tenía que recordar)
en arreglos dentro del repo. Con un `.env` correcto, el despliegue se hace con **`./deploy.sh`**
sin recordar nada. Se mantiene el modelo **VPN-only + Caddy interno + PostgreSQL 16** y no se
filtra ningún secreto al repo.

---

## Qué cambió (por tarea, un commit cada una)

| # | Cambio | Archivos |
|---|--------|----------|
| 1 | **`DATABASE_URL`/`REDIS_URL` derivadas** de `POSTGRES_*`/`REDIS_PASSWORD` (patrón del worker). Si vienen explícitas en el `.env`, esas ganan (back-compat). | `docker-compose.yml` |
| 2 | **`TRUST_PROXY: ${TRUST_PROXY:-2}`** inyectado en la API (cadena Caddy→Next→API). Recupera la IP real → rate-limit / CSRF-por-IP / Turnstile vuelven a discriminar. | `docker-compose.yml` |
| 3 | **Servicio one-shot `migrate`**: corre `prisma migrate deploy` (idempotente) y `api`/`worker` dependen de su finalización. **Servir sin esquema es imposible.** Ya no es un paso manual. | `docker-compose.staging.yml`, `Caddyfile` |
| 4 | **Seed idempotente**: entidades con clave única → `upsert`; las demás → guardia por conteo. Re-correrlo no duplica. **Sin contraseñas hardcodeadas**: lee `SEED_*_PASSWORD` o genera aleatorias y las imprime una vez. | `api/prisma/seed.ts` |
| 5 | **`.dockerignore`**: nuevo en `worker/`, endurecidos `api/`/`web/` (`.env*`, logs, `node_modules`, etc.). Evita contaminar el build con binarios nativos del host. | `*/.dockerignore` |
| 6 | **Plantillas `.env` a prueba de errores**: placeholders `CAMBIA_ESTO_*` que `env.ts` **rechaza** al arranque (olvidar un valor falla claro, no inseguro). `DATABASE_URL`/`REDIS_URL` opcionales; marcas build-time. | `.env.staging.example`, `env.staging.plantilla.txt` |
| 7 | **Caddyfile** verificado: un solo origen HTTPS interno `flotillas.internal` (`tls internal`) → `web:3000`. | `Caddyfile` |
| 8 | **`deploy.sh`** de un comando: valida `.env`, detecta placeholders, exige Compose ≥ 2.24 (avisa del fallback de puertos), build, dependencias healthy, migraciones automáticas, smoke test de `/api/health`. | `deploy.sh` |
| 9 | **Doc Turnstile corregida**: la afirmación falsa de que el runbook sugería una *test key* estaba en la GUÍA (el runbook ya pedía el secret real). Reconciliados los Gotchas 1/4/5 como **resueltos** y el 6 (seed). | `GUIA-DESPLIEGUE-LINUX.md`, `flotillas-runbook.md` |
| 10 | **`.gitignore`**: ignora la CA raíz exportada de Caddy (`*caddy*root.crt`). | `.gitignore` |

> No se tocó `api/src/config/env.ts` (su rechazo de placeholders/test-keys/localhost es la red de
> seguridad y es intencional). No se cambió la versión de PostgreSQL (16). No se publican puertos de
> DB/Redis al host.

---

## Decisiones de criterio (confirmadas)
- **Migraciones → servicio one-shot `migrate`** (automático), en vez de paso manual.
- **`TRUST_PROXY` → en el compose base** (`${TRUST_PROXY:-2}`); el `.env` puede sobreescribirlo.

---

## Verificación
- API: `prisma validate` ✓ · `tsc --noEmit` ✓ · `npm run build` ✓ · typecheck de `prisma/seed.ts` ✓
- Web: `lint` ✓ (0 errores) · `tsc --noEmit` ✓
- Worker: `py_compile` ✓
- Compose base+staging: merge simulado → api deriva DB URL + `TRUST_PROXY`, depende de `migrate`;
  servicio `migrate` correcto; puertos de DB/Redis/api **no** publicados; Caddy solo en `10.10.0.2`.
- ⚠️ `web npm run build` en el **host** falla por `lightningcss` (binario nativo por-plataforma del
  `node_modules` de Windows/WSL). **No es bug de código**: el build real corre con `npm ci` fresco
  dentro de Docker y en CI (ubuntu). Dentro de Docker funciona.

---

## Cómo desplegar en el servidor
```bash
cp .env.staging.example .env && nano .env   # reemplaza cada CAMBIA_ESTO_*
chmod 600 .env
./deploy.sh                                  # build + migraciones + smoke test
```
Acceso (solo por VPN): **https://flotillas.internal**

`.env` mínimo: `NODE_ENV` · `POSTGRES_USER/PASSWORD/DB` · `REDIS_PASSWORD` · `JWT_SECRET` (≥64) ·
`TURNSTILE_SECRET` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (reales de Cloudflare) ·
`CORS_ALLOWED_ORIGINS=https://flotillas.internal` · `TRUST_PROXY=2`.

---

## ✅ Migraciones reparadas — `migrate deploy` ahora funciona en BD limpia

Al probar el despliegue desde 0 aparecieron **bugs pre-existentes del historial de migraciones** (el
schema se había venido aplicando con `db push`/`migrate dev`, no con migraciones versionadas). Un
`migrate deploy` limpio producía un esquema roto/incompleto. **Arreglado** con 2 migraciones nuevas:

- `20260421041508_add_audit_logs_table` — la tabla `audit_logs` (modelo `AuditLog`) que ninguna migración
  creaba (solo existía la que le crea el índice) → antes fallaba con `42P01`.
- `20260527165001_sync_schema_drift` — columnas que faltaban: **`vehicles`** (`expedientNumber`,
  `engineNumber`, `area`, `usage`, `vehicleClass`, … 13 en total + índice único) y **`users`**
  (`lockedUntil`, `lastLoginAt`), más normalización de FKs. Sin esto, **importar vehículos reales habría
  fallado** y el lockout de login daba `P2022`.

Verificado en BD limpia: **10 migraciones aplican sin error**, `prisma migrate diff` reporta *empty
migration* (cero drift), y el servicio one-shot `migrate` de staging ya funciona en el primer despliegue.

## ✅ Primer admin sin datos demo — `bootstrap-admin`

Con la BD limpia no hay usuarios (el seed demo está bloqueado en producción y mete datos de ejemplo). Se
añadió `api/src/scripts/bootstrap-admin.ts` (npm `bootstrap:admin`) que crea/actualiza un **ADMIN** desde
`ADMIN_EMAIL`/`ADMIN_PASSWORD` (idempotente, valida, no eco de la contraseña). En el servidor:
```bash
$COMPOSE run --rm -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='claveFuerte' api npm run bootstrap:admin
```

---

## ✅ Prueba local — CORRIENDO AHORA (modo dev), LIMPIO para datos reales

El stack dev está **levantado** con la BD **vacía (desde 0)** salvo un admin — listo para cargar coches reales:

| Recurso | URL |
|---|---|
| **Web (app)** | **http://localhost:3000** |
| Login | http://localhost:3000/login |
| API health | http://localhost:3001/api/health → `{"status":"ok"}` |

**Admin (temporal, cámbialo):** `admin@flotillas.com` / `Admin-Local-2026!` — login verificado (HTTP 200).
BD: 1 usuario (admin), 0 vehículos. Sin datos demo. Usa un `.env` local desechable (gitignored).

Reproducir desde 0:
```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
$COMPOSE down -v && $COMPOSE up -d --build postgres redis api web   # empieza limpio
$COMPOSE exec api npx prisma migrate deploy                          # 10 migraciones, sin drift
$COMPOSE exec -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='claveFuerte' api npx tsx src/scripts/bootstrap-admin.ts
```
Apagar: `$COMPOSE down` (con `-v` borra datos). **No** se corre el seed demo (es para QA, no para datos reales).

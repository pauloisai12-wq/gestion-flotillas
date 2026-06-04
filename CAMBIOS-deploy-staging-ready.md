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

## ✅ Prueba local — CORRIENDO AHORA (modo dev)

El stack dev está **levantado y verificado** en esta máquina (sin la infra de servidor LUKS/VPN/Caddy/Turnstile):

| Recurso | URL |
|---|---|
| **Web (app)** | **http://localhost:3000** |
| Login | http://localhost:3000/login |
| API health | http://localhost:3001/api/health → `{"status":"ok"}` |
| Portal público (sin login) | http://localhost:3000/cargas/registro-rapido |

**Credenciales demo (sembradas):**

| Usuario | Contraseña | Rol |
|---|---|---|
| admin@flotillas.com | `admin-local` | ADMIN |
| vehiculos@ / gasolina@ / mantenimiento@flotillas.com | `super-local` | Supervisores |
| ejecutor1@ / ejecutor2@flotillas.com | `ejecutor-local` | EXECUTOR |
| taller1@ / taller2@ / taller3@flotillas.com | `taller-local` | WORKSHOP |

Verificado: login admin → HTTP 200 (JWT). Seed **idempotente** confirmado (2ª corrida: conteos idénticos,
sin duplicar). Usa un `.env` local desechable (gitignored, sin secretos reales).

Comandos (para reproducir / reiniciar):
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build postgres redis api web
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api npx prisma db push   # ver nota ⚠ abajo
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec \
  -e SEED_ADMIN_PASSWORD=admin-local -e SEED_SUPER_PASSWORD=super-local \
  -e SEED_EXECUTOR_PASSWORD=ejecutor-local -e SEED_WORKSHOP_PASSWORD=taller-local \
  api npx prisma db seed
```
Para apagar: `docker compose -f docker-compose.yml -f docker-compose.dev.yml down` (añade `-v` para borrar datos).

---

## ⚠️ BLOQUEADOR PRE-EXISTENTE descubierto (NO es de estos cambios) — requiere tu decisión

Al levantar la prueba salió un bug **del historial de migraciones**, independiente de mis 10 tareas
(tocar migraciones estaba fuera de alcance, y la premisa era que el despliegue funcionaba):

- El schema declara `model AuditLog @@map("audit_logs")`, pero **ninguna migración crea la tabla
  `audit_logs`**. La migración `20260521000000_audit_log_global_created_at_index` solo le crea un
  **índice** a esa tabla inexistente → `prisma migrate deploy` **falla en una BD nueva** con
  `42P01: relation "audit_logs" does not exist`.
- La BD histórica en esta máquina funcionaba porque se creó con `db push`/`migrate dev` (que sí crea la
  tabla desde el modelo); el repo nunca incluyó la migración `CREATE TABLE "audit_logs"`.

**Impacto:** afecta el `migrate deploy` en limpio — es decir, el **servicio one-shot `migrate`** de staging
fallaría en el primer despliegue real sobre una BD vacía. Para la prueba local lo reconcilié con
`prisma db push` (crea `audit_logs` + lo faltante, preserva las vistas materializadas ya migradas).

**Recomendación (pendiente de tu OK):** crear una migración que haga `CREATE TABLE "audit_logs" (...)`
**antes** de `20260521000000_...`, o regenerar el diff con `prisma migrate diff`. Es un arreglo de
**migraciones** (lo dejé fuera por instrucción); dime si quieres que lo haga.

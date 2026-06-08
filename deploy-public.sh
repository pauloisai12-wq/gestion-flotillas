#!/usr/bin/env bash
#
# deploy-public.sh — despliegue de un solo comando para flotillas-v2 en un VPS
# PÚBLICO (QA abierto, HTTPS Let's Encrypt). Hermano de deploy.sh (servidor de casa).
#
# Encapsula la secuencia correcta para un VPS dedicado expuesto a internet
# (NODE_ENV=production, Caddy en 0.0.0.0:80/443 con cert automático) SIN que el
# operador deba recordar pasos manuales:
#   - valida que exista .env y que no queden placeholders sin reemplazar,
#   - exige Docker Compose >= 2.24 (el override usa `!reset []`),
#   - build de imágenes dentro de Docker,
#   - levanta dependencias y espera a que estén healthy,
#   - el servicio one-shot `migrate` aplica `prisma migrate deploy` ANTES de
#     servir tráfico (definido en docker-compose.public.yml),
#   - smoke test de /api/health.
#
# NO contiene secretos. Es idempotente: re-ejecutarlo converge el stack.
# Uso:   ./deploy-public.sh
set -Eeuo pipefail

# Ejecutar siempre desde la raíz del repo (donde viven .env y los compose).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

readonly ENV_FILE=".env"
readonly ENV_TEMPLATE=".env.public.example"
readonly MIN_MAJOR=2
readonly MIN_MINOR=24

c_red()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
c_grn()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
c_ylw()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()    { c_red "ERROR: $*"; exit 1; }

trap 'c_red "deploy-public.sh abortó (línea $LINENO). Revisa el mensaje anterior."' ERR

# ── 1. .env existe ──────────────────────────────────────────────────────────
step "Validando ${ENV_FILE}"
[ -f "$ENV_FILE" ] || die "no existe ${ENV_FILE}. Crea uno:  cp ${ENV_TEMPLATE} ${ENV_FILE} && nano ${ENV_FILE}"

# ── 2. Escaneo barato de placeholders (antes de tocar Postgres) ─────────────
# Si quedó un CAMBIA_ESTO/__REEMPLAZA__, Postgres inicializaría su volumen con
# una password placeholder y luego la API abortaría: mejor fallar AQUÍ.
# Se ignoran líneas de comentario (#...) para no falsear con la cabecera.
placeholders="$(grep -vE '^[[:space:]]*#' "$ENV_FILE" | grep -nE 'CAMBIA_ESTO|__REEMPLAZA__' || true)"
if [ -n "$placeholders" ]; then
  c_red "Hay valores placeholder sin reemplazar en ${ENV_FILE}:"
  # Mostrar solo la clave, enmascarando el valor.
  echo "$placeholders" | sed -E 's/=.*$/=<placeholder, reemplázalo>/' >&2
  die "completa esos valores (ver ${ENV_TEMPLATE}) y vuelve a ejecutar."
fi
c_grn "  .env presente y sin placeholders."

# ── 3. Detectar binario de Docker Compose ───────────────────────────────────
step "Detectando Docker Compose"
if docker compose version >/dev/null 2>&1; then
  COMPOSE_BASE=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
  COMPOSE_BASE=(docker-compose)
else
  die "no se encontró 'docker compose' ni 'docker-compose'. Instala Docker Compose >= ${MIN_MAJOR}.${MIN_MINOR}."
fi

# ── 4. Exigir Compose >= 2.24 (`!reset []`) ─────────────────────────────────
ver_raw="$("${COMPOSE_BASE[@]}" version --short 2>/dev/null | tr -d 'v ' || true)"
ver_major="${ver_raw%%.*}"
ver_rest="${ver_raw#*.}"; ver_minor="${ver_rest%%.*}"
if [[ "$ver_major" =~ ^[0-9]+$ && "$ver_minor" =~ ^[0-9]+$ ]]; then
  if (( ver_major < MIN_MAJOR || (ver_major == MIN_MAJOR && ver_minor < MIN_MINOR) )); then
    c_red "Docker Compose ${ver_raw} es < ${MIN_MAJOR}.${MIN_MINOR}."
    cat >&2 <<'GOTCHA3'

  El override docker-compose.public.yml usa `ports: !reset []`, que requiere
  Compose >= 2.24. NO lo aplico automáticamente. Opciones:
    a) Actualiza Docker Compose a >= 2.24 (recomendado;  curl -fsSL https://get.docker.com | sh), o
    b) edita docker-compose.public.yml y elimina cada servicio que lleva
       `ports: !reset []` SI ese servicio no hereda puertos problemáticos.
GOTCHA3
    die "actualiza Compose y reintenta."
  fi
  c_grn "  Docker Compose ${ver_raw} (>= ${MIN_MAJOR}.${MIN_MINOR})."
else
  c_ylw "  No pude parsear la versión de Compose ('${ver_raw}'); continúo. Asegúrate de tener >= ${MIN_MAJOR}.${MIN_MINOR}."
fi

# Comando Compose combinado (base + override público).
# `-p flotillas` AÍSLA el proyecto (red/volúmenes/ciclo de vida) por consistencia
# con el resto de los comandos del repo.
COMPOSE=("${COMPOSE_BASE[@]}" -p flotillas -f docker-compose.yml -f docker-compose.public.yml)
c_ylw "  COMPOSE=\"${COMPOSE[*]}\""

# ── 5. Build de imágenes (dentro de Docker) ─────────────────────────────────
step "Construyendo imágenes (api/web/worker)"
"${COMPOSE[@]}" build

# ── 6. Dependencias healthy ─────────────────────────────────────────────────
step "Levantando postgres + redis y esperando healthy"
"${COMPOSE[@]}" up -d --wait postgres redis

# ── 7. Migraciones + resto del stack ────────────────────────────────────────
# `up -d --wait` ordena: postgres(healthy) -> migrate(prisma migrate deploy,
# service_completed_successfully) -> api/worker/web/caddy (healthy). Caddy pedirá
# el cert Let's Encrypt en su primer arranque (necesita el puerto 80 abierto).
step "Aplicando migraciones (servicio one-shot) y levantando el stack"
"${COMPOSE[@]}" up -d --wait --wait-timeout 240

# ── 8. Smoke test de /api/health (vía exec; el 3001 no se publica) ──────────
step "Smoke test: /api/health"
ok=""
for i in 1 2 3 4 5; do
  if body="$("${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:3001/api/health 2>/dev/null)"; then
    ok=1; break
  fi
  sleep 3
done
if [ -n "$ok" ]; then
  c_grn "  /api/health OK: ${body}"
else
  "${COMPOSE[@]}" ps || true
  die "el smoke test de /api/health falló. Revisa:  ${COMPOSE[*]} logs --tail=50 api"
fi

# ── 9. Listo ────────────────────────────────────────────────────────────────
step "Despliegue completo"
"${COMPOSE[@]}" ps

# Dominio público leído del .env (CORS_ALLOWED_ORIGINS) para el banner.
public_url="$(grep -E '^CORS_ALLOWED_ORIGINS=' "$ENV_FILE" | head -1 | cut -d= -f2- | cut -d, -f1)"
cat <<EOF

$(c_grn "Stack arriba.")  Acceso público:  ${public_url:-https://<tu-dominio>}

Si es el primer arranque, dale a Caddy ~30s para emitir el certificado:
    ${COMPOSE[*]} logs caddy | grep -i "certificate obtained"

Siguientes pasos (una vez):
  - Datos demo para QA (dashboards poblados; usa contraseñas FUERTES):
      ${COMPOSE[*]} run --rm -e NODE_ENV=development \\
        -e SEED_ADMIN_PASSWORD='...' -e SEED_SUPER_PASSWORD='...' \\
        -e SEED_EXECUTOR_PASSWORD='...' -e SEED_WORKSHOP_PASSWORD='...' \\
        api npx prisma db seed
  - (Alternativa sin demo) crear solo el primer ADMIN (la BD arranca vacía):
      ${COMPOSE[*]} run --rm \\
        -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='UnaPasswordFuerte12+' \\
        api node dist/scripts/bootstrap-admin.js
  - Comparte las credenciales con los revisores fuera de banda.
EOF

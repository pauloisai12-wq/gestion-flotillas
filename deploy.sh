#!/usr/bin/env bash
#
# deploy.sh — despliegue de un solo comando para flotillas-v2 (QA/Staging).
#
# Encapsula la secuencia correcta para el servidor de casa (VPN + Caddy interno,
# NODE_ENV=production) SIN que el operador deba recordar ningún paso manual:
#   - valida que exista .env y que no queden placeholders sin reemplazar,
#   - exige Docker Compose >= 2.24 (el override usa `!reset []`),
#   - build de imágenes dentro de Docker,
#   - levanta dependencias y espera a que estén healthy,
#   - el servicio one-shot `migrate` aplica `prisma migrate deploy` ANTES de
#     servir tráfico (definido en docker-compose.staging.yml),
#   - smoke test de /api/health.
#
# NO contiene secretos. Es idempotente: re-ejecutarlo converge el stack.
# Uso:   ./deploy.sh
set -Eeuo pipefail

# Ejecutar siempre desde la raíz del repo (donde viven .env y los compose).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

readonly ENV_FILE=".env"
readonly ENV_TEMPLATE=".env.staging.example"
readonly MIN_MAJOR=2
readonly MIN_MINOR=24

c_red()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
c_grn()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
c_ylw()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()    { c_red "ERROR: $*"; exit 1; }

trap 'c_red "deploy.sh abortó (línea $LINENO). Revisa el mensaje anterior."' ERR

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

# ── 4. Exigir Compose >= 2.24 (Gotcha 3: `!reset []`) ───────────────────────
ver_raw="$("${COMPOSE_BASE[@]}" version --short 2>/dev/null | tr -d 'v ' || true)"
ver_major="${ver_raw%%.*}"
ver_rest="${ver_raw#*.}"; ver_minor="${ver_rest%%.*}"
if [[ "$ver_major" =~ ^[0-9]+$ && "$ver_minor" =~ ^[0-9]+$ ]]; then
  if (( ver_major < MIN_MAJOR || (ver_major == MIN_MAJOR && ver_minor < MIN_MINOR) )); then
    c_red "Docker Compose ${ver_raw} es < ${MIN_MAJOR}.${MIN_MINOR}."
    cat >&2 <<'GOTCHA3'

  El override docker-compose.staging.yml usa `ports: !reset []`, que requiere
  Compose >= 2.24. NO lo aplico automáticamente. Opciones:
    a) Actualiza Docker Compose a >= 2.24 (recomendado), o
    b) edita docker-compose.staging.yml y reemplaza cada `ports: !reset []`
       por un bind a la IP VPN, p.ej.:
           ports:
             - "10.10.0.2:5432:5432"
       (postgres/redis/api/web) — manteniéndolos en la interfaz WireGuard.
GOTCHA3
    die "actualiza Compose o aplica el fallback de puertos y reintenta."
  fi
  c_grn "  Docker Compose ${ver_raw} (>= ${MIN_MAJOR}.${MIN_MINOR})."
else
  c_ylw "  No pude parsear la versión de Compose ('${ver_raw}'); continúo. Asegúrate de tener >= ${MIN_MAJOR}.${MIN_MINOR}."
fi

# Comando Compose combinado (base + override de staging).
COMPOSE=("${COMPOSE_BASE[@]}" -f docker-compose.yml -f docker-compose.staging.yml)
c_ylw "  COMPOSE=\"${COMPOSE[*]}\""

# ── 5. Build de imágenes (dentro de Docker) ─────────────────────────────────
step "Construyendo imágenes (api/web/worker)"
"${COMPOSE[@]}" build

# ── 6. Dependencias healthy ─────────────────────────────────────────────────
step "Levantando postgres + redis y esperando healthy"
"${COMPOSE[@]}" up -d --wait postgres redis

# ── 7. Migraciones + resto del stack ────────────────────────────────────────
# `up -d --wait` ordena: postgres(healthy) -> migrate(prisma migrate deploy,
# service_completed_successfully) -> api/worker/web/caddy (healthy). Si algo no
# llega a healthy en el timeout, el comando falla y deploy.sh aborta.
step "Aplicando migraciones (servicio one-shot) y levantando el stack"
"${COMPOSE[@]}" up -d --wait --wait-timeout 240

# ── 8. Smoke test de /api/health (vía exec; el 3001 no se publica en staging) ─
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
cat <<EOF

$(c_grn "Stack arriba.")  Acceso (solo por VPN):  https://flotillas.internal

Siguientes pasos (una vez):
  - Exportar la CA interna de Caddy para distribuir a los revisores:
      ${COMPOSE[*]} cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
  - Asegurar la resolución  flotillas.internal -> 10.10.0.2  en cada cliente.
  - (Opcional, BD vacía) datos demo:
      ${COMPOSE[*]} run --rm -e NODE_ENV=development api npx prisma db seed
EOF

#!/usr/bin/env bash
#
# deploy-common.sh — lógica compartida de despliegue para flotillas-v2.
#
# NO se ejecuta directamente: lo cargan con `source` deploy.sh (QA/Staging por
# VPN) y deploy-public.sh (VPS público), que antes del source definen:
#   SCRIPT_NAME         — nombre del script llamador (para el trap de error).
#   ENV_TEMPLATE        — plantilla a sugerir si falta .env.
#   COMPOSE_OVERRIDE    — archivo compose de override (staging/public).
#   COMPOSE_OLD_DIE_MSG — mensaje de die si Docker Compose es < 2.24.
#   gotcha_reset_help() — función que imprime (a stderr) la ayuda del
#                         `ports: !reset []` específica de su override.
# El banner final (URL de acceso, siguientes pasos) también lo imprime cada
# script tras el source, reutilizando el array COMPOSE definido aquí.
#
# NO contiene secretos. Es idempotente: re-ejecutarlo converge el stack.

# Guard: este archivo es para `source`, no para ejecutarse solo.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "deploy-common.sh no se ejecuta directamente; usa ./deploy.sh o ./deploy-public.sh" >&2
  exit 1
fi

readonly ENV_FILE=".env"
readonly MIN_MAJOR=2
readonly MIN_MINOR=24

c_red()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
c_grn()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
c_ylw()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()    { c_red "ERROR: $*"; exit 1; }

trap 'c_red "${SCRIPT_NAME} abortó (línea $LINENO). Revisa el mensaje anterior."' ERR

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

# ── 2.bis. Disco de datos montado (evita la BD fantasma) ────────────────────
# Si el override persiste Postgres/Redis en un mountpoint (LUKS en staging) y ESE
# disco NO está montado, Docker crearía el bind mount como carpeta VACÍA en el
# disco raíz e inicializaría una base FANTASMA: usuarios/datos "desaparecen" al
# reiniciar y el stack termina leyendo una BD distinta de la real. Fallar AQUÍ.
if [ -n "${REQUIRE_MOUNT:-}" ]; then
  step "Verificando que el disco de datos esté montado: ${REQUIRE_MOUNT}"
  if ! mountpoint -q "${REQUIRE_MOUNT}" 2>/dev/null; then
    die "${REQUIRE_MOUNT} NO está montado. El stack persiste Postgres/Redis ahí (disco cifrado LUKS).
       Arrancar ahora crearía una base VACÍA en el disco raíz (datos fantasma + los reales quedan inaccesibles).
       Desbloquea y monta el LUKS primero, verifica con  'mountpoint -q ${REQUIRE_MOUNT}'  y reintenta."
  fi
  c_grn "  ${REQUIRE_MOUNT} montado."
fi

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
    gotcha_reset_help
    die "${COMPOSE_OLD_DIE_MSG}"
  fi
  c_grn "  Docker Compose ${ver_raw} (>= ${MIN_MAJOR}.${MIN_MINOR})."
else
  c_ylw "  No pude parsear la versión de Compose ('${ver_raw}'); continúo. Asegúrate de tener >= ${MIN_MAJOR}.${MIN_MINOR}."
fi

# Comando Compose combinado (base + override del entorno).
# `-p flotillas` AÍSLA el proyecto del SAS (red/volúmenes/ciclo de vida). Sin esto
# el nombre por defecto sería el de la carpeta y podría chocar con el SAS (§4).
COMPOSE=("${COMPOSE_BASE[@]}" -p flotillas -f docker-compose.yml -f "${COMPOSE_OVERRIDE}")
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
# llega a healthy en el timeout, el comando falla y el script aborta. (En el
# modo público, Caddy pedirá el cert Let's Encrypt en su primer arranque;
# necesita el puerto 80 abierto.)
step "Aplicando migraciones (servicio one-shot) y levantando el stack"
"${COMPOSE[@]}" up -d --wait --wait-timeout 240

# ── 8. Smoke test de /api/health (vía exec; el 3001 no se publica al host) ──
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

# ── 9. Listo (el banner final lo imprime cada script tras el source) ────────
step "Despliegue completo"
"${COMPOSE[@]}" ps

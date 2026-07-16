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
receipt_key_is_placeholder() { [[ "${1^^}" == CAMBIA* ]]; }

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

  if [ "${REQUIRE_LUKS_BACKING:-false}" = "true" ]; then
    command -v findmnt >/dev/null 2>&1 || die "falta findmnt para demostrar el backing LUKS"
    command -v lsblk >/dev/null 2>&1 || die "falta lsblk para demostrar el backing LUKS"
    mount_source="$(findmnt -nro SOURCE --target "$REQUIRE_MOUNT" 2>/dev/null || true)"
    source_device="$(printf '%s' "$mount_source" | sed 's/\[.*$//')"
    luks_types=""
    if [[ "$source_device" = /dev/* ]]; then
      luks_types="$(lsblk -sno TYPE "$source_device" 2>/dev/null | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' || true)"
    fi
    if grep -Fxq crypt <<< "$luks_types"; then
      c_grn "  Backing cifrado confirmado por lsblk: ${mount_source}."
    elif [ -n "$luks_types" ]; then
      die "${REQUIRE_MOUNT} resuelve a ${mount_source}, pero su árbol de bloques NO contiene TYPE=crypt (${luks_types//$'\n'/, })."
    elif [ "${FLOTILLAS_ALLOW_UNRESOLVED_LUKS:-}" = "I_CONFIRMED_ENCRYPTION_THIS_RUN" ]; then
      c_ylw "  No se pudo resolver el backing con lsblk (${mount_source:-sin source}); aceptando confirmación manual SOLO para esta ejecución."
    else
      die "no se pudo demostrar que ${REQUIRE_MOUNT} esté sobre dm-crypt/LUKS (source='${mount_source:-desconocido}').
       Solo para layouts cifrados que findmnt/lsblk no modelan, verifica manualmente y ejecuta:
       FLOTILLAS_ALLOW_UNRESOLVED_LUKS=I_CONFIRMED_ENCRYPTION_THIS_RUN ./${SCRIPT_NAME}"
    fi
  fi
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

# Lee solo variables operativas concretas sin `source .env` (un .env nunca debe
# ejecutarse como shell). Acepta comentarios al final y valores entre comillas.
read_env_setting() {
  local key="$1"
  local line value
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
  if [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

# Un solo lock serializa deploys y backups programados. El descriptor 9 queda
# abierto durante todo el script llamador: build, snapshot, migración,
# recuperación y smoke test.
source ./scripts/ops/operation-lock.sh
backup_dir="$(read_env_setting BACKUP_DIR)"
backup_dir="${backup_dir:-${DEFAULT_BACKUP_DIR:-}}"
[ -n "$backup_dir" ] || die "BACKUP_DIR es obligatorio para adquirir el lock operativo"
if flotillas_acquire_operation_lock "$backup_dir"; then
  c_grn "  Lock operativo adquirido: ${FLOTILLAS_OPERATION_LOCK_PATH}"
else
  lock_status=$?
  if [ "$lock_status" -eq 5 ]; then
    die "ya hay otro deploy o backup en ejecución; no se permiten ciclos operativos concurrentes"
  fi
  die "no se pudo crear/adquirir el lock operativo dentro de BACKUP_DIR: ${backup_dir}"
fi

# ── 5. Build de imágenes (dentro de Docker) ─────────────────────────────────
step "Construyendo imágenes (api/web/worker)"
"${COMPOSE[@]}" build

# ── 6. Dependencias healthy ─────────────────────────────────────────────────
step "Levantando postgres + redis y esperando healthy"
"${COMPOSE[@]}" up -d --wait postgres redis

# ── 7. Guardia de respaldo obligatoria antes de migrar ──────────────────────
# La excepción exige confirmación explícita Y que la instalación esté realmente
# vacía (sin relaciones de usuario, uploads ni reportes). Una bandera olvidada
# en true jamás evita el backup de una instalación ya inicializada.
step "Creando respaldo verificable antes de cualquier migración"
backup_required_mount="$(read_env_setting BACKUP_REQUIRE_MOUNT)"
backup_required_mount="${backup_required_mount:-${DEFAULT_BACKUP_REQUIRE_MOUNT:-}}"
backup_recipient="$(read_env_setting BACKUP_AGE_RECIPIENT)"
backup_receipt_key="$(read_env_setting BACKUP_RECEIPT_HMAC_KEY)"
if [ "${BACKUP_PROFILE:-unknown}" = "public" ] && [ "${#backup_receipt_key}" -lt 32 ]; then
  die "BACKUP_RECEIPT_HMAC_KEY es obligatorio (>=32 caracteres) para fechar backups públicos sin descifrarlos"
fi
if [ -n "$backup_receipt_key" ] && receipt_key_is_placeholder "$backup_receipt_key"; then
  die "BACKUP_RECEIPT_HMAC_KEY conserva un placeholder CAMBIA...; genera una clave real"
fi
allow_first_deploy="$(read_env_setting ALLOW_FIRST_DEPLOY_WITHOUT_BACKUP)"
allow_first_deploy="${allow_first_deploy:-false}"
backup_stop_timeout="$(read_env_setting OPS_BACKUP_STOP_TIMEOUT_SECONDS)"
backup_stop_timeout="${backup_stop_timeout:-120}"
# El entorno del proceso tiene precedencia sobre .env en Compose. Detectarlo
# evita que `DATABASE_URL=... ./deploy.sh` migre una BD que la guardia no volcó.
if [[ -v DATABASE_URL ]]; then
  database_url_override="$DATABASE_URL"
else
  database_url_override="$(read_env_setting DATABASE_URL)"
fi

if ! guard_result="$(
  BACKUP_DIR="$backup_dir" \
  BACKUP_REQUIRE_MOUNT="$backup_required_mount" \
  BACKUP_AGE_RECIPIENT="$backup_recipient" \
  BACKUP_RECEIPT_HMAC_KEY="$backup_receipt_key" \
  BACKUP_PROFILE="${BACKUP_PROFILE:-unknown}" \
  BACKUP_STOP_TIMEOUT_SECONDS="$backup_stop_timeout" \
  ALLOW_FIRST_DEPLOY_WITHOUT_BACKUP="$allow_first_deploy" \
  DATABASE_URL_OVERRIDE="$database_url_override" \
  PRIMARY_DATA_MOUNT="${PRIMARY_DATA_MOUNT:-}" \
    bash ./scripts/ops/predeploy-guard.sh -- "${COMPOSE[@]}"
)"; then
  die "la guardia previa bloqueó el despliegue. No se ejecutaron migraciones."
fi
if [ "$guard_result" = "FIRST_DEPLOY_NO_BACKUP" ]; then
  c_ylw "  Primer despliegue vacío confirmado; única excepción sin backup aceptada."
else
  c_grn "  Backup previo completo: ${guard_result}"
fi

# El servicio migrate rechaza el valor por defecto UNGUARDED. Este token vive
# solo en el proceso actual y evita que un `docker compose up` manual ejecute
# migraciones accidentalmente fuera de la guardia.
export FLOTILLAS_PREDEPLOY_GUARD="passed-${BACKUP_PROFILE:-unknown}-$(date -u +%Y%m%dT%H%M%SZ)-$$"

# La guardia exitosa deja detenidos los escritores que estaban activos. Solo
# ahora es seguro normalizar ownership: un fallo previo conserva los permisos
# de la imagen anterior y un fallo posterior ya tiene un backup verificable.
if declare -F prepare_persistent_storage >/dev/null 2>&1; then
  step "Preparando almacenamiento persistente del perfil"
  prepare_persistent_storage
fi

# ── 8. Migraciones + resto del stack ────────────────────────────────────────
# `up -d --wait` ordena: postgres(healthy) -> migrate(prisma migrate deploy,
# service_completed_successfully) -> api/worker/web/caddy (healthy). Si algo no
# llega a healthy en el timeout, el comando falla y el script aborta. (En el
# modo público, Caddy pedirá el cert Let's Encrypt en su primer arranque;
# necesita el puerto 80 abierto.)
step "Aplicando migraciones (servicio one-shot) y levantando el stack"
"${COMPOSE[@]}" up -d --wait --wait-timeout 240

# ── 9. Smoke test de /api/health (vía exec; el 3001 no se publica al host) ──
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

# ── 10. Listo (el banner final lo imprime cada script tras el source) ───────
step "Despliegue completo"
"${COMPOSE[@]}" ps

#!/usr/bin/env bash
# Backup periódico del perfil Hetzner. Detiene solo los escritores que estaban
# activos, crea el bundle cifrado y restaura exactamente ese estado operativo.
set -Eeuo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/../.." && pwd)"
cd "$root_dir"
source "${script_dir}/operation-lock.sh"

die() {
  printf 'ERROR backup-public: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Uso:
  bash scripts/ops/backup-public.sh [--env-file /ruta/.env]
  bash scripts/ops/backup-public.sh --check

La clave pública age se lee de BACKUP_AGE_RECIPIENT. La identidad privada no
se necesita para respaldar y no debe residir en el VPS.
USAGE
}

read_env_setting() {
  local key="$1"
  local file="$2"
  local line value
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
  if [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

setting() {
  local key="$1"
  local default_value="${2:-}"
  if printenv "$key" >/dev/null 2>&1; then
    printenv "$key"
  else
    local value
    value="$(read_env_setting "$key" "$env_file")"
    printf '%s' "${value:-$default_value}"
  fi
}

# BACKUP_DIR define también el namespace del lock compartido. Para que un
# override de proceso no permita que backup y deploy bloqueen archivos
# distintos sobre el mismo proyecto Compose, el env-file es la fuente canónica
# y cualquier override presente debe coincidir exactamente.
select_backup_dir() {
  local configured_value="$1"
  local process_override_present="$2"
  local process_override_value="$3"

  configured_value="${configured_value:-/var/backups/flotillas}"
  case "$process_override_present" in true|false) ;; *) return 2 ;; esac
  if [ "$process_override_present" = "true" ] && \
     [ "$process_override_value" != "$configured_value" ]; then
    return 3
  fi
  printf '%s' "$configured_value"
}

select_maintenance_file() {
  local backup_dir_value="$1"
  local requested_value="$2"
  local expected_value resolved_value

  [ -n "$backup_dir_value" ] && [[ "$backup_dir_value" = /* ]] || return 2
  [ -n "$requested_value" ] && [[ "$requested_value" = /* ]] || return 2
  expected_value="$(realpath -m "${backup_dir_value%/}/.maintenance.json")" || return 2
  resolved_value="$(realpath -m "$requested_value")" || return 2
  [ "$resolved_value" = "$expected_value" ] || return 3
  [ ! -L "$requested_value" ] || return 4
  printf '%s' "$expected_value"
}

is_public_bundle_name() {
  [[ "$1" =~ ^flotillas-public-[0-9]{8}T[0-9]{6}Z$ ]]
}

receipt_key_is_placeholder() {
  [[ "${1^^}" == CAMBIA* ]]
}

self_check() {
  local check_dir check_env
  for check_command in ln mktemp realpath rm; do
    command -v "$check_command" >/dev/null 2>&1 || \
      die "falta el comando de self-check: ${check_command}"
  done
  is_public_bundle_name "flotillas-public-20000101T000000Z"
  ! is_public_bundle_name "../flotillas-public-20000101T000000Z"
  ! is_public_bundle_name "flotillas-staging-20000101T000000Z"
  receipt_key_is_placeholder "CAMBIA_ESTO_CLAVE_LARGA"
  ! receipt_key_is_placeholder "self-check-receipt-key-32-bytes-minimum"
  [ "$(select_backup_dir "" false "")" = "/var/backups/flotillas" ]
  [ "$(select_backup_dir "/srv/backup" true "/srv/backup")" = "/srv/backup" ]
  if select_backup_dir "/srv/backup-a" true "/srv/backup-b" >/dev/null; then
    die "un BACKUP_DIR de proceso distinto al env-file no fue rechazado"
  fi
  [ "$(
    select_maintenance_file "/srv/backup" "/srv/backup/.maintenance.json"
  )" = "/srv/backup/.maintenance.json" ]

  check_dir="$(mktemp -d)"
  trap 'rm -rf -- "${check_dir:-}"' EXIT
  check_env="${check_dir}/.env"
  printf 'ENV_CENTINELA=no-tocar\n' > "$check_env"
  if select_maintenance_file "$check_dir" "$check_env" >/dev/null; then
    die "OPS_MAINTENANCE_FILE aceptó .env fuera del nombre permitido"
  fi
  ln -s "$check_env" "${check_dir}/.maintenance.json"
  if select_maintenance_file "$check_dir" "${check_dir}/.maintenance.json" >/dev/null; then
    die "OPS_MAINTENANCE_FILE aceptó un symlink hacia .env"
  fi
  [ "$(<"$check_env")" = "ENV_CENTINELA=no-tocar" ] || \
    die "el self-check alteró el .env centinela"
  rm -rf -- "$check_dir"
  check_dir=""
  trap - EXIT
  printf 'OK backup-public --check: nombres, perfil y restauración selectiva habilitados.\n'
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  self_check
  exit 0
fi

env_file=".env"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      [ "$#" -ge 2 ] || die "--env-file requiere una ruta"
      env_file="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "opción desconocida: $1"
      ;;
  esac
done

if [[ "$env_file" != /* ]]; then
  env_file="${root_dir}/${env_file}"
fi
[ -f "$env_file" ] || die "env file inexistente: ${env_file}"
[ ! -L "$env_file" ] || die "el env file no puede ser symlink: ${env_file}"

for command_name in bash chmod date dirname docker find flock grep mkdir mv realpath rm sed sleep sort tail; do
  command -v "$command_name" >/dev/null 2>&1 || die "falta el comando: ${command_name}"
done

configured_backup_dir="$(read_env_setting BACKUP_DIR "$env_file")"
configured_backup_dir="${configured_backup_dir:-/var/backups/flotillas}"
process_backup_dir=""
process_backup_dir_present="false"
if printenv BACKUP_DIR >/dev/null 2>&1; then
  process_backup_dir="$(printenv BACKUP_DIR)"
  process_backup_dir_present="true"
fi
if ! backup_dir="$(
  select_backup_dir "$configured_backup_dir" \
    "$process_backup_dir_present" "$process_backup_dir"
)"; then
  die "BACKUP_DIR del proceso ('${process_backup_dir}') difiere del env-file ('${configured_backup_dir}'); se rechaza dividir el namespace del lock operativo"
fi
recipient="$(setting BACKUP_AGE_RECIPIENT)"
receipt_key="$(setting BACKUP_RECEIPT_HMAC_KEY)"
retention="$(setting OPS_BACKUP_RETENTION_COUNT 28)"
stop_timeout="$(setting OPS_BACKUP_STOP_TIMEOUT_SECONDS 120)"
maintenance_seconds="$(setting OPS_BACKUP_MAINTENANCE_SECONDS 2700)"

[[ "$backup_dir" = /* ]] || die "BACKUP_DIR debe ser absoluto"
[ -n "$recipient" ] || die "BACKUP_AGE_RECIPIENT está vacío"
[ "${#receipt_key}" -ge 32 ] || die "BACKUP_RECEIPT_HMAC_KEY debe tener al menos 32 caracteres"
! receipt_key_is_placeholder "$receipt_key" || \
  die "BACKUP_RECEIPT_HMAC_KEY conserva un placeholder CAMBIA...; genera una clave real"
[[ "$retention" =~ ^[0-9]+$ ]] && [ "$retention" -ge 1 ] && [ "$retention" -le 365 ] || \
  die "OPS_BACKUP_RETENTION_COUNT debe estar entre 1 y 365"
[[ "$stop_timeout" =~ ^[0-9]+$ ]] && [ "$stop_timeout" -ge 30 ] && [ "$stop_timeout" -le 900 ] || \
  die "OPS_BACKUP_STOP_TIMEOUT_SECONDS debe estar entre 30 y 900"
[[ "$maintenance_seconds" =~ ^[0-9]+$ ]] && [ "$maintenance_seconds" -ge 300 ] && [ "$maintenance_seconds" -le 7200 ] || \
  die "OPS_BACKUP_MAINTENANCE_SECONDS debe estar entre 300 y 7200"

if flotillas_acquire_operation_lock "$backup_dir"; then
  :
else
  lock_status=$?
  if [ "$lock_status" -eq 5 ]; then
    die "ya hay otro deploy o backup en ejecución"
  fi
  die "no se pudo adquirir el lock operativo dentro de BACKUP_DIR"
fi
requested_maintenance_file="$(setting OPS_MAINTENANCE_FILE "${backup_dir}/.maintenance.json")"
if ! maintenance_file="$(
  select_maintenance_file "$backup_dir" "$requested_maintenance_file"
)"; then
  die "OPS_MAINTENANCE_FILE debe resolver exactamente a '${backup_dir%/}/.maintenance.json', sin symlinks"
fi

compose=(
  docker compose --env-file "$env_file" -p flotillas
  -f docker-compose.yml -f docker-compose.public.yml
)
"${compose[@]}" config --quiet

running_services="$("${compose[@]}" ps --services --status running)" || \
  die "no se pudo consultar el estado de Compose"
for dependency in postgres redis; do
  grep -Fxq "$dependency" <<< "$running_services" || \
    die "${dependency} debe estar running antes del backup"
done
if grep -Fxq migrate <<< "$running_services"; then
  die "migrate está activo; no se respalda durante un cambio de esquema"
fi

stopped_services=()
maintenance_active=0

array_contains() {
  local wanted="$1"
  shift
  local item
  for item in "$@"; do
    [ "$item" = "$wanted" ] && return 0
  done
  return 1
}

restore_services() {
  local service
  local failed=0
  for service in api worker-python web caddy; do
    if array_contains "$service" "${stopped_services[@]}"; then
      printf 'Restaurando servicio %s...\n' "$service" >&2
      "${compose[@]}" start "$service" >/dev/null || failed=1
    fi
  done
  [ "$failed" -eq 0 ] || return 1

  local attempt all_healthy
  for attempt in {1..60}; do
    all_healthy=1
    for service in "${stopped_services[@]}"; do
      case "$service" in
        api)
          "${compose[@]}" exec -T api \
            wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1 || all_healthy=0
          ;;
        worker-python)
          "${compose[@]}" exec -T worker-python \
            python healthcheck.py >/dev/null 2>&1 || all_healthy=0
          ;;
        web)
          "${compose[@]}" exec -T web \
            wget --quiet --tries=1 --spider http://127.0.0.1:3000 >/dev/null 2>&1 || all_healthy=0
          ;;
        caddy)
          "${compose[@]}" ps --services --status running | grep -Fxq caddy || all_healthy=0
          ;;
      esac
    done
    [ "$all_healthy" -eq 1 ] && return 0
    sleep 3
  done
  return 1
}

publish_maintenance() {
  local parent temporary created expires safe_maintenance_file
  safe_maintenance_file="$(
    select_maintenance_file "$backup_dir" "$maintenance_file"
  )" || die "OPS_MAINTENANCE_FILE dejó de ser la ruta segura esperada"
  maintenance_file="$safe_maintenance_file"
  parent="$(dirname "$maintenance_file")"
  mkdir -p -- "$parent"
  temporary="${maintenance_file}.$$.tmp"
  created="$(date +%s)"
  expires=$((created + maintenance_seconds))
  printf '{"format":"flotillas-maintenance-v1","reason":"consistent-backup","created_epoch":%s,"expires_epoch":%s,"pid":%s}\n' \
    "$created" "$expires" "$$" > "$temporary"
  chmod 600 "$temporary"
  mv -- "$temporary" "$maintenance_file"
  maintenance_active=1
}

clear_maintenance() {
  local safe_maintenance_file
  safe_maintenance_file="$(
    select_maintenance_file "$backup_dir" "$maintenance_file"
  )" || {
    printf 'ERROR backup-public: se rechazó limpiar un OPS_MAINTENANCE_FILE fuera de BACKUP_DIR.\n' >&2
    return 1
  }
  maintenance_file="$safe_maintenance_file"
  rm -f -- "${maintenance_file}.$$.tmp"
  if [ "$maintenance_active" -eq 1 ]; then
    rm -f -- "$maintenance_file"
    maintenance_active=0
  fi
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT INT TERM
  if [ "${#stopped_services[@]}" -gt 0 ]; then
    restore_services || {
      printf 'ERROR backup-public: no se pudo restaurar todo el estado previo.\n' >&2
      status=1
    }
  fi
  clear_maintenance
  exit "$status"
}
trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
publish_maintenance

# Se corta primero el ingreso. El timeout de 120 s por defecto coincide con el
# stop_grace_period del worker para permitir que cierre el job activo.
for service in caddy web api worker-python; do
  if grep -Fxq "$service" <<< "$running_services"; then
    printf 'Deteniendo %s para snapshot consistente...\n' "$service" >&2
    stopped_services+=("$service")
    "${compose[@]}" stop --timeout "$stop_timeout" "$service" >/dev/null
  fi
done

bundle_path="$(
  BACKUP_DIR="$backup_dir" \
  BACKUP_AGE_RECIPIENT="$recipient" \
  BACKUP_RECEIPT_HMAC_KEY="$receipt_key" \
  BACKUP_PROFILE=public \
    bash "${script_dir}/backup.sh" -- "${compose[@]}"
)" || die "falló la creación del bundle"

if ! restore_services; then
  die "el backup existe, pero no se restauró todo el estado previo"
fi
stopped_services=()
clear_maintenance

# Retención local acotada. Solo elimina bundles completos con nombre exacto y
# ubicados como hijos directos de BACKUP_DIR; nunca sigue symlinks ni parciales.
resolved_backup_dir="$(realpath -m "$backup_dir")"
mapfile -t bundle_names < <(
  find "$resolved_backup_dir" -mindepth 1 -maxdepth 1 -type d \
    -name 'flotillas-public-????????T??????Z' -printf '%f\n' | LC_ALL=C sort -r
)
for ((index = retention; index < ${#bundle_names[@]}; index++)); do
  name="${bundle_names[$index]}"
  is_public_bundle_name "$name" || continue
  candidate="${resolved_backup_dir}/${name}"
  [ ! -L "$candidate" ] || continue
  [ -f "${candidate}/encrypted.sha256" ] || continue
  [ "$(realpath -m "$candidate")" = "$candidate" ] || continue
  printf 'Rotando backup local antiguo: %s\n' "$name" >&2
  rm -rf -- "$candidate"
done

trap - EXIT INT TERM
printf '%s\n' "$bundle_path"

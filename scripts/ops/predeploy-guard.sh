#!/usr/bin/env bash
# Guardia previa a migraciones: solo permite continuar con un backup nuevo y
# validado, salvo un primer despliegue comprobablemente vacío.
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/operation-lock.sh"

die() {
  printf 'ERROR predeploy: %s\n' "$*" >&2
  exit 1
}

receipt_key_is_placeholder() {
  [[ "${1^^}" == CAMBIA* ]]
}

usage() {
  cat <<'USAGE'
Uso:
  BACKUP_DIR=/ruta BACKUP_AGE_RECIPIENT=age1... \
  ALLOW_FIRST_DEPLOY_WITHOUT_BACKUP=false BACKUP_PROFILE=staging \
    bash scripts/ops/predeploy-guard.sh -- docker compose ...
  bash scripts/ops/predeploy-guard.sh --check

`--check` prueba la clasificación de la guardia y el manifiesto/checksums sin
Docker, age ni acceso a datos.
USAGE
}

classify_state() {
  local db_relations="$1"
  local uploads_state="$2"
  local reports_state="$3"
  local allow_first="$4"

  [[ "$db_relations" =~ ^[0-9]+$ ]] || return 2
  case "$uploads_state" in EMPTY|NONEMPTY) ;; *) return 2 ;; esac
  case "$reports_state" in EMPTY|NONEMPTY) ;; *) return 2 ;; esac
  case "$allow_first" in true|false) ;; *) return 2 ;; esac

  if [ "$db_relations" -eq 0 ] && [ "$uploads_state" = "EMPTY" ] && [ "$reports_state" = "EMPTY" ]; then
    if [ "$allow_first" = "true" ]; then
      printf 'SKIP_VERIFIED_FIRST_DEPLOY\n'
    else
      printf 'BLOCK_FIRST_DEPLOY_CONFIRMATION_REQUIRED\n'
    fi
  else
    # La bandera de primer despliegue nunca evita el backup si existe una sola
    # relación o entrada en cualquiera de los dos almacenes.
    printf 'BACKUP_REQUIRED\n'
  fi
}

expect_classification() {
  local expected="$1"
  shift
  local actual
  actual="$(classify_state "$@")" || die "falló caso de self-check: $*"
  [ "$actual" = "$expected" ] || die "esperaba ${expected}, obtuve ${actual}"
}

guard_check_tmp_dir=""

cleanup_guard_check() {
  if [ -n "${guard_check_tmp_dir:-}" ] && [ -d "$guard_check_tmp_dir" ]; then
    rm -rf -- "$guard_check_tmp_dir"
  fi
}

local_store_state() {
  local target="$1"
  if [ -n "$(find "$target" -mindepth 1 \( -type f -o -type l \) -print -quit)" ]; then
    printf 'NONEMPTY\n'
  else
    printf 'EMPTY\n'
  fi
}

self_check() {
  receipt_key_is_placeholder "CAMBIA_ESTO_CLAVE_LARGA"
  ! receipt_key_is_placeholder "self-check-receipt-key-32-bytes-minimum"
  expect_classification BLOCK_FIRST_DEPLOY_CONFIRMATION_REQUIRED 0 EMPTY EMPTY false
  expect_classification SKIP_VERIFIED_FIRST_DEPLOY 0 EMPTY EMPTY true
  expect_classification BACKUP_REQUIRED 1 EMPTY EMPTY true
  expect_classification BACKUP_REQUIRED 0 NONEMPTY EMPTY true
  expect_classification BACKUP_REQUIRED 0 EMPTY NONEMPTY true
  if classify_state nope EMPTY EMPTY false >/dev/null 2>&1; then
    die "la guardia aceptó un conteo inválido"
  fi

  # El esqueleto de directorios vacío que trae la imagen no es dato de negocio.
  # Un archivo o symlink sí debe anular inmediatamente el bypass.
  guard_check_tmp_dir="$(mktemp -d)"
  trap cleanup_guard_check EXIT
  mkdir -p "${guard_check_tmp_dir}/uploads/esqueleto/vacio"
  [ "$(local_store_state "${guard_check_tmp_dir}/uploads")" = "EMPTY" ] || \
    die "un subdirectorio vacío fue clasificado como dato"
  printf 'dato\n' > "${guard_check_tmp_dir}/uploads/esqueleto/evidencia.txt"
  [ "$(local_store_state "${guard_check_tmp_dir}/uploads")" = "NONEMPTY" ] || \
    die "un archivo real no anuló el bypass"

  bash "${script_dir}/backup.sh" --check
  printf 'OK predeploy --check: bypass limitado a instalación totalmente vacía.\n'
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  self_check
  exit 0
fi

[ "${1:-}" = "--" ] || {
  usage >&2
  exit 2
}
shift
[ "$#" -gt 0 ] || die "falta el comando Docker Compose después de --"
compose=("$@")

backup_dir="${BACKUP_DIR:-}"
backup_required_mount="${BACKUP_REQUIRE_MOUNT:-}"
primary_data_mount="${PRIMARY_DATA_MOUNT:-}"
recipient="${BACKUP_AGE_RECIPIENT:-}"
receipt_key="${BACKUP_RECEIPT_HMAC_KEY:-}"
profile="${BACKUP_PROFILE:-unknown}"
allow_first="${ALLOW_FIRST_DEPLOY_WITHOUT_BACKUP:-false}"
database_url_override="${DATABASE_URL_OVERRIDE:-}"
stop_timeout="${BACKUP_STOP_TIMEOUT_SECONDS:-120}"

[ -n "$backup_dir" ] || die "BACKUP_DIR es obligatorio para adquirir el lock operativo"
[[ "$backup_dir" = /* ]] || die "BACKUP_DIR debe ser una ruta absoluta"
if [ -n "${FLOTILLAS_OPERATION_LOCK_FD:-}" ] || [ -n "${FLOTILLAS_OPERATION_LOCK_PATH:-}" ]; then
  flotillas_verify_inherited_operation_lock "$backup_dir" || \
    die "el lock operativo heredado no es válido para BACKUP_DIR"
else
  if flotillas_acquire_operation_lock "$backup_dir"; then
    :
  else
    lock_status=$?
    if [ "$lock_status" -eq 5 ]; then
      die "ya hay otro deploy o backup en ejecución"
    fi
    die "no se pudo adquirir el lock operativo dentro de BACKUP_DIR"
  fi
fi

if [ "$profile" = "public" ] && [ "${#receipt_key}" -lt 32 ]; then
  die "BACKUP_RECEIPT_HMAC_KEY es obligatorio (>=32 caracteres), incluso en el primer despliegue público"
fi
if [ -n "$receipt_key" ] && receipt_key_is_placeholder "$receipt_key"; then
  die "BACKUP_RECEIPT_HMAC_KEY conserva un placeholder CAMBIA...; genera una clave real"
fi

case "$allow_first" in true|false) ;; *) die "ALLOW_FIRST_DEPLOY_WITHOUT_BACKUP debe ser true o false" ;; esac
[[ "$stop_timeout" =~ ^[0-9]+$ ]] && [ "$stop_timeout" -ge 30 ] && [ "$stop_timeout" -le 900 ] || \
  die "BACKUP_STOP_TIMEOUT_SECONDS debe estar entre 30 y 900"
if [ -n "$database_url_override" ]; then
  die "DATABASE_URL externa/explicita no está soportada por esta guardia: no podría demostrar que respaldó la BD usada por migrate. Usa el PostgreSQL del compose o implementa una guardia equivalente para el proveedor externo."
fi

printf 'Inspeccionando si PostgreSQL contiene esquema de aplicación...\n' >&2
relations_sql="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r', 'p', 'm', 'S', 'v');"
if ! db_relations="$(
  "${compose[@]}" exec -T postgres sh -ceu \
    'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-align --tuples-only --quiet --command="$1"' \
    sh "$relations_sql"
)"; then
  die "no se pudo inspeccionar PostgreSQL; no se permite continuar sin determinar su estado"
fi
db_relations="${db_relations//$'\r'/}"
db_relations="${db_relations//[[:space:]]/}"
[[ "$db_relations" =~ ^[0-9]+$ ]] || die "PostgreSQL devolvió un conteo inesperado: '${db_relations}'"

inspect_store() {
  local target="$1"
  local state
  if ! state="$(
    "${compose[@]}" run --rm --no-deps -T --user 0:0 --entrypoint sh api -ceu '
      target="$1"
      test -d "$target"
      if [ -n "$(find "$target" -mindepth 1 \( -type f -o -type l \) -print -quit)" ]; then
        printf "NONEMPTY\\n"
      else
        printf "EMPTY\\n"
      fi
    ' sh "$target"
  )"; then
    die "no se pudo inspeccionar el almacén ${target}"
  fi
  state="${state//$'\r'/}"
  case "$state" in EMPTY|NONEMPTY) printf '%s\n' "$state" ;; *) die "estado inesperado para ${target}: '${state}'" ;; esac
}

uploads_state="$(inspect_store /app/uploads)"
reports_state="$(inspect_store /app/storage/reports)"
decision="$(classify_state "$db_relations" "$uploads_state" "$reports_state" "$allow_first")" || \
  die "no se pudo clasificar el estado previo al despliegue"

# En staging, el mount independiente es precondición incluso para el primer
# deploy: así no se inicializa una instalación que quedará sin destino seguro
# para su siguiente migración.
if [ -n "$backup_required_mount" ]; then
  [ -n "$backup_dir" ] || die "BACKUP_DIR es obligatorio cuando BACKUP_REQUIRE_MOUNT está definido"
  command -v mountpoint >/dev/null 2>&1 || die "falta mountpoint para validar BACKUP_REQUIRE_MOUNT"
  command -v realpath >/dev/null 2>&1 || die "falta realpath para validar BACKUP_DIR"
  command -v stat >/dev/null 2>&1 || die "falta stat para validar el dispositivo de backup"
  [[ "$backup_required_mount" = /* ]] || die "BACKUP_REQUIRE_MOUNT debe ser una ruta absoluta"
  mountpoint -q "$backup_required_mount" || \
    die "${backup_required_mount} no está montado; se rechaza escribir el backup en el disco raíz"
  resolved_backup_mount="$(realpath -m "$backup_required_mount")"
  resolved_backup_dir="$(realpath -m "$backup_dir")"
  case "$resolved_backup_dir" in
    "$resolved_backup_mount"|"$resolved_backup_mount"/*) ;;
    *) die "BACKUP_DIR (${backup_dir} -> ${resolved_backup_dir}) escapa de BACKUP_REQUIRE_MOUNT (${resolved_backup_mount})" ;;
  esac
  if [ -n "$primary_data_mount" ]; then
    mountpoint -q "$primary_data_mount" || die "el mount principal ${primary_data_mount} dejó de estar disponible"
    backup_device="$(stat -c '%d' "$backup_required_mount")"
    primary_device="$(stat -c '%d' "$primary_data_mount")"
    [ "$backup_device" != "$primary_device" ] || \
      die "el backup y los datos primarios están en el mismo filesystem/dispositivo; usa un mount independiente"
  fi
fi

case "$decision" in
  SKIP_VERIFIED_FIRST_DEPLOY)
    printf 'AVISO: excepción explícita de primer despliegue aceptada: 0 relaciones, uploads vacío y reports vacío.\n' >&2
    printf 'FIRST_DEPLOY_NO_BACKUP\n'
    exit 0
    ;;
  BLOCK_FIRST_DEPLOY_CONFIRMATION_REQUIRED)
    die "instalación totalmente vacía detectada. Para confirmar SOLO este primer despliegue, define ALLOW_FIRST_DEPLOY_WITHOUT_BACKUP=true. En cuanto exista esquema o un archivo, esa bandera deja de ser un bypass."
    ;;
  BACKUP_REQUIRED)
    [ -n "$backup_dir" ] || die "BACKUP_DIR es obligatorio antes de migrar una instalación existente"
    [ -n "$recipient" ] || die "BACKUP_AGE_RECIPIENT es obligatorio antes de migrar una instalación existente"
    if ! mkdir -p -- "$backup_dir" || [ ! -w "$backup_dir" ]; then
      die "BACKUP_DIR no puede ser creado/escrito por el usuario de deploy: ${backup_dir}"
    fi
    ;;
  *)
    die "decisión interna desconocida: ${decision}"
    ;;
esac

if ! running_services="$("${compose[@]}" ps --services --status running)"; then
  die "no se pudo consultar qué servicios deben detenerse"
fi
if grep -Fxq migrate <<< "$running_services"; then
  die "migrate sigue en ejecución; no se permite respaldar durante un cambio de esquema"
fi

stopped_services=()
restore_on_failure=1

was_running() {
  grep -Fxq "$1" <<< "$running_services"
}

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
  [ "${#stopped_services[@]}" -gt 0 ] || return 0
  printf 'Restaurando servicios detenidos porque el backup falló...\n' >&2
  for service in api worker-python web caddy; do
    if array_contains "$service" "${stopped_services[@]}"; then
      "${compose[@]}" start "$service" >/dev/null || \
        printf 'AVISO: no se pudo reiniciar %s; intervención manual requerida.\n' "$service" >&2
    fi
  done
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$restore_on_failure" -eq 1 ]; then
    restore_services
  fi
  exit "$status"
}
trap cleanup_on_exit EXIT

# Cerrar primero el ingreso y después los escritores. `docker compose stop`
# evita que restart:unless-stopped los vuelva a levantar durante el snapshot.
for service in caddy web api worker-python; do
  if was_running "$service"; then
    printf 'Deteniendo %s para snapshot consistente...\n' "$service" >&2
    stopped_services+=("$service")
    "${compose[@]}" stop --timeout "$stop_timeout" "$service" >/dev/null
  fi
done

if ! bundle_path="$(
  BACKUP_DIR="$backup_dir" \
  BACKUP_AGE_RECIPIENT="$recipient" \
  BACKUP_RECEIPT_HMAC_KEY="$receipt_key" \
  BACKUP_PROFILE="$profile" \
    bash "${script_dir}/backup.sh" -- "${compose[@]}"
)"; then
  die "el backup previo falló; migraciones bloqueadas"
fi

restore_on_failure=0
trap - EXIT
printf '%s\n' "$bundle_path"

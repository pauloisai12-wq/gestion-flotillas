#!/usr/bin/env bash
# Simulacro no destructivo: valida archivos y restaura PostgreSQL en una base
# scratch que verify-restore.sh elimina siempre. Publica una evidencia atómica.
set -Eeuo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/../.." && pwd)"
cd "$root_dir"

die() {
  printf 'ERROR restore-drill-public: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Uso:
  BACKUP_AGE_IDENTITY=/ruta/identity.txt \
    bash scripts/ops/restore-drill-public.sh --bundle /ruta/flotillas-public-... \
      --bundle-source offsite \
      [--env-file /ruta/.env] [--receipt-dir /ruta/receipts]
  bash scripts/ops/restore-drill-public.sh --check

La identidad privada se acepta solo en el entorno del proceso: no se lee de
.env ni se pasa como argumento a age. Solo `--bundle-source offsite` puede
demostrar el RPO; `local` ejecuta la prueba técnica pero deja `rpo_met=false`.
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

calculate_backup_age_minutes() {
  local created_epoch="$1"
  local now_epoch="$2"
  [[ "$created_epoch" =~ ^[0-9]+$ && "$now_epoch" =~ ^[0-9]+$ ]] || return 2
  [ "$created_epoch" -le $((now_epoch + 60)) ] || return 2
  local age_seconds=$((now_epoch - created_epoch))
  [ "$age_seconds" -ge 0 ] || age_seconds=0
  # Redondeo hacia arriba: 360 minutos + 1 segundo ya incumple un RPO de 6 h.
  printf '%s\n' "$(((age_seconds + 59) / 60))"
}

self_check() {
  example="restore-drill-public-20000101T000000Z-123"
  [[ "$example" =~ ^restore-drill-public-[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]
  [ "$(calculate_backup_age_minutes 1000 1360)" -eq 6 ]
  [ "$(calculate_backup_age_minutes 1000 1361)" -eq 7 ]
  ! calculate_backup_age_minutes 1100 1000 >/dev/null
  printf 'OK restore-drill-public --check: scratch restore, RPO/RTO y recibo atómico configurados.\n'
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  self_check
  exit 0
fi

env_file=".env"
bundle_dir=""
receipt_dir=""
bundle_source="local"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      [ "$#" -ge 2 ] || die "--env-file requiere una ruta"
      env_file="$2"
      shift 2
      ;;
    --bundle)
      [ "$#" -ge 2 ] || die "--bundle requiere una ruta"
      bundle_dir="$2"
      shift 2
      ;;
    --receipt-dir)
      [ "$#" -ge 2 ] || die "--receipt-dir requiere una ruta"
      receipt_dir="$2"
      shift 2
      ;;
    --bundle-source)
      [ "$#" -ge 2 ] || die "--bundle-source requiere local u offsite"
      bundle_source="$2"
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
[ ! -L "$env_file" ] || die "el env file no puede ser symlink"
[ -n "$bundle_dir" ] || die "falta --bundle"
[ -d "$bundle_dir" ] || die "bundle inexistente: ${bundle_dir}"
[ ! -L "$bundle_dir" ] || die "el bundle no puede ser symlink"
[ -n "${BACKUP_AGE_IDENTITY:-}" ] || die "BACKUP_AGE_IDENTITY está vacío"
[ -r "$BACKUP_AGE_IDENTITY" ] || die "la identidad age no es legible"
case "$bundle_source" in local|offsite) ;; *) die "--bundle-source solo acepta local u offsite" ;; esac

for command_name in age awk basename bash cat chmod date docker grep mkdir mv rm sed sha256sum tail; do
  command -v "$command_name" >/dev/null 2>&1 || die "falta el comando: ${command_name}"
done

backup_dir="$(read_env_setting BACKUP_DIR "$env_file")"
backup_dir="${backup_dir:-/var/backups/flotillas}"
configured_receipt_dir="${OPS_DRILL_RECEIPT_DIR:-$(read_env_setting OPS_DRILL_RECEIPT_DIR "$env_file")}"
receipt_dir="${receipt_dir:-${configured_receipt_dir:-${backup_dir}/drill-receipts}}"
rpo_minutes="${OPS_RPO_TARGET_MINUTES:-$(read_env_setting OPS_RPO_TARGET_MINUTES "$env_file")}"
rto_minutes="${OPS_RTO_TARGET_MINUTES:-$(read_env_setting OPS_RTO_TARGET_MINUTES "$env_file")}"
rpo_minutes="${rpo_minutes:-360}"
rto_minutes="${rto_minutes:-120}"
[[ "$receipt_dir" = /* ]] || die "receipt-dir debe ser absoluto"
[[ "$rpo_minutes" =~ ^[0-9]+$ ]] && [ "$rpo_minutes" -ge 1 ] && [ "$rpo_minutes" -le 10080 ] || \
  die "OPS_RPO_TARGET_MINUTES debe estar entre 1 y 10080"
[[ "$rto_minutes" =~ ^[0-9]+$ ]] && [ "$rto_minutes" -ge 1 ] && [ "$rto_minutes" -le 1440 ] || \
  die "OPS_RTO_TARGET_MINUTES debe estar entre 1 y 1440"

started_epoch="$(date +%s)"
[ -f "${bundle_dir}/manifest.txt.age" ] || die "falta manifest.txt.age"
[ ! -L "${bundle_dir}/manifest.txt.age" ] || die "manifest.txt.age no puede ser symlink"
if ! backup_created_utc="$(
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" "${bundle_dir}/manifest.txt.age" |
    awk -F= '
      $1 == "created_utc" {
        if (found) exit 2
        print substr($0, index($0, "=") + 1)
        found = 1
      }
      END { if (!found) exit 1 }
    '
)"; then
  die "no se pudo leer created_utc único del manifiesto cifrado"
fi
[[ "$backup_created_utc" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || \
  die "created_utc no usa el formato UTC esperado"
backup_created_epoch="$(date -u -d "$backup_created_utc" +%s 2>/dev/null)" || \
  die "created_utc no representa una fecha válida"
backup_age_minutes="$(calculate_backup_age_minutes "$backup_created_epoch" "$started_epoch")" || \
  die "created_utc está demasiado adelantado respecto al reloj del host"
rpo_met="false"
if [ "$bundle_source" = "offsite" ] && [ "$backup_age_minutes" -le "$rpo_minutes" ]; then
  rpo_met="true"
fi

compose=(
  docker compose --env-file "$env_file" -p flotillas
  -f docker-compose.yml -f docker-compose.public.yml
)
"${compose[@]}" config --quiet

[ ! -L "$receipt_dir" ] || die "receipt-dir no puede ser symlink"
mkdir -p -- "$receipt_dir"
chmod 700 "$receipt_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
receipt_name="restore-drill-public-${stamp}-$$"
partial_dir="${receipt_dir}/.${receipt_name}.partial"
final_dir="${receipt_dir}/${receipt_name}"
[ ! -e "$partial_dir" ] && [ ! -e "$final_dir" ] || die "ya existe evidencia del simulacro"
mkdir -m 700 -- "$partial_dir"

cleanup_partial() {
  if [ -n "${partial_dir:-}" ] && [ -d "$partial_dir" ]; then
    rm -rf -- "$partial_dir"
  fi
}
trap cleanup_partial EXIT

set +e
verification_output="$(
  BACKUP_AGE_IDENTITY="$BACKUP_AGE_IDENTITY" \
    bash "${script_dir}/verify-restore.sh" --bundle "$bundle_dir" \
      --scratch-restore -- "${compose[@]}" 2>&1
)"
verification_status=$?
set -e
finished_epoch="$(date +%s)"
duration_seconds=$((finished_epoch - started_epoch))
printf '%s\n' "$verification_output"
printf '%s\n' "$verification_output" > "${partial_dir}/verification.log"

rto_met="false"
if [ "$verification_status" -eq 0 ] && [ "$duration_seconds" -le $((rto_minutes * 60)) ]; then
  rto_met="true"
fi
result="failure"
if [ "$verification_status" -eq 0 ] && [ "$rpo_met" = "true" ] && [ "$rto_met" = "true" ]; then
  result="success"
fi
bundle_hash="unavailable"
if [ -f "${bundle_dir}/encrypted.sha256" ] && [ ! -L "${bundle_dir}/encrypted.sha256" ]; then
  bundle_hash="$(sha256sum "${bundle_dir}/encrypted.sha256" | awk '{print $1}')"
fi
log_hash="$(sha256sum "${partial_dir}/verification.log" | awk '{print $1}')"
cat > "${partial_dir}/receipt.txt" <<RECEIPT
format=flotillas-restore-drill-v1
completed_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
profile=public-hetzner
result=${result}
bundle=$(basename "$bundle_dir")
bundle_source=${bundle_source}
bundle_checksums_sha256=${bundle_hash}
verification_log_sha256=${log_hash}
duration_seconds=${duration_seconds}
backup_created_utc=${backup_created_utc}
backup_age_minutes=${backup_age_minutes}
rpo_target_minutes=${rpo_minutes}
rpo_met=${rpo_met}
rto_target_minutes=${rto_minutes}
rto_met=${rto_met}
database_target=scratch-only
production_database_modified=false
RECEIPT
chmod 600 "${partial_dir}/receipt.txt" "${partial_dir}/verification.log"
mv -- "$partial_dir" "$final_dir"
partial_dir=""
trap - EXIT

printf 'Evidencia del simulacro: %s\n' "$final_dir"
[ "$verification_status" -eq 0 ] || exit "$verification_status"
[ "$bundle_source" = "offsite" ] || \
  die "restore correcto, pero una copia local no demuestra RPO; usa --bundle-source offsite"
[ "$rpo_met" = "true" ] || \
  die "restore correcto, pero backup_age_minutes=${backup_age_minutes} excede RPO=${rpo_minutes}"
[ "$rto_met" = "true" ] || die "restore correcto, pero excedió el RTO objetivo"

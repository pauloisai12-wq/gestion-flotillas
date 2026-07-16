#!/usr/bin/env bash
# Respaldo cifrado de PostgreSQL + uploads + reportes.
# Los tres artefactos se transmiten directamente a age: no se escriben copias
# de datos en claro en disco. Debe invocarlo predeploy-guard.sh con los
# escritores detenidos.
set -Eeuo pipefail
umask 077
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/operation-lock.sh"

die() {
  printf 'ERROR backup: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Uso:
  BACKUP_DIR=/ruta BACKUP_AGE_RECIPIENT=age1... BACKUP_PROFILE=staging \
    bash scripts/ops/backup.sh -- docker compose ...
  bash scripts/ops/backup.sh --check

`--check` ejecuta una prueba autocontenida de manifiesto/checksums. No usa
Docker, age ni datos reales.
USAGE
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "falta el comando requerido: $1"
}

receipt_key_is_placeholder() {
  [[ "${1^^}" == CAMBIA* ]]
}

file_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

file_bytes() {
  wc -c < "$1" | tr -d '[:space:]'
}

write_manifest() {
  local bundle_dir="$1"
  local created_utc="$2"
  local profile="$3"
  local db_toc_entries="$4"
  local uploads_entries="$5"
  local reports_entries="$6"
  local manifest_path="${bundle_dir}/manifest.txt"
  local db_file="database.dump.age"
  local uploads_file="uploads.tar.age"
  local reports_file="reports.tar.age"

  {
    printf 'format=flotillas-backup-v1\n'
    printf 'created_utc=%s\n' "$created_utc"
    printf 'profile=%s\n' "$profile"
    printf 'consistency=application-writers-stopped\n'
    printf 'database.format=postgresql-custom\n'
    printf 'database.validation=pg_restore-list\n'
    printf 'database.toc_entries=%s\n' "$db_toc_entries"
    printf 'uploads.format=tar\n'
    printf 'uploads.validation=tar-list\n'
    printf 'uploads.entries=%s\n' "$uploads_entries"
    printf 'reports.format=tar\n'
    printf 'reports.validation=tar-list\n'
    printf 'reports.entries=%s\n' "$reports_entries"
    printf 'artifact.database.file=%s\n' "$db_file"
    printf 'artifact.database.bytes=%s\n' "$(file_bytes "${bundle_dir}/${db_file}")"
    printf 'artifact.database.sha256=%s\n' "$(file_sha256 "${bundle_dir}/${db_file}")"
    printf 'artifact.uploads.file=%s\n' "$uploads_file"
    printf 'artifact.uploads.bytes=%s\n' "$(file_bytes "${bundle_dir}/${uploads_file}")"
    printf 'artifact.uploads.sha256=%s\n' "$(file_sha256 "${bundle_dir}/${uploads_file}")"
    printf 'artifact.reports.file=%s\n' "$reports_file"
    printf 'artifact.reports.bytes=%s\n' "$(file_bytes "${bundle_dir}/${reports_file}")"
    printf 'artifact.reports.sha256=%s\n' "$(file_sha256 "${bundle_dir}/${reports_file}")"
  } > "$manifest_path"
}

write_encrypted_checksums() {
  local bundle_dir="$1"
  (
    cd "$bundle_dir"
    sha256sum database.dump.age uploads.tar.age reports.tar.age manifest.txt.age > encrypted.sha256
    sha256sum --check encrypted.sha256 >/dev/null
  )
}

self_check_tmp_dir=""

cleanup_self_check() {
  if [ -n "${self_check_tmp_dir:-}" ] && [ -d "$self_check_tmp_dir" ]; then
    rm -rf -- "$self_check_tmp_dir"
  fi
}

self_check() {
  need_command awk
  need_command cp
  need_command grep
  need_command mktemp
  need_command python3
  need_command sha256sum
  need_command wc
  receipt_key_is_placeholder "CAMBIA_ESTO_CLAVE_LARGA"
  ! receipt_key_is_placeholder "self-check-receipt-key-32-bytes-minimum"

  self_check_tmp_dir="$(mktemp -d)"
  trap cleanup_self_check EXIT

  # Artefactos ficticios ya "cifrados": la prueba valida estructura y hashes,
  # no criptografía. La ejecución real exige age y valida su código de salida.
  printf 'stub-db\n' > "${self_check_tmp_dir}/database.dump.age"
  printf 'stub-uploads\n' > "${self_check_tmp_dir}/uploads.tar.age"
  printf 'stub-reports\n' > "${self_check_tmp_dir}/reports.tar.age"
  write_manifest "$self_check_tmp_dir" "2000-01-01T00:00:00Z" "self-check" "3" "1" "1"
  cp "${self_check_tmp_dir}/manifest.txt" "${self_check_tmp_dir}/manifest.txt.age"
  rm -f -- "${self_check_tmp_dir}/manifest.txt"
  write_encrypted_checksums "$self_check_tmp_dir"
  BACKUP_RECEIPT_HMAC_KEY="self-check-receipt-key-32-bytes-minimum" \
    python3 "${script_dir}/backup_receipt.py" create \
      --bundle-dir "$self_check_tmp_dir" \
      --created-utc "2000-01-01T00:00:00Z" \
      --profile "self-check" \
      --bundle-name "flotillas-self-check-20000101T000000Z" >/dev/null
  BACKUP_RECEIPT_HMAC_KEY="self-check-receipt-key-32-bytes-minimum" \
    python3 "${script_dir}/backup_receipt.py" verify \
      --receipt "${self_check_tmp_dir}/receipt.json" >/dev/null

  grep -qx 'format=flotillas-backup-v1' "${self_check_tmp_dir}/manifest.txt.age"
  grep -qx 'consistency=application-writers-stopped' "${self_check_tmp_dir}/manifest.txt.age"
  [ "$(grep -c '^artifact\..*\.sha256=' "${self_check_tmp_dir}/manifest.txt.age")" -eq 3 ]
  printf 'OK backup --check: manifiesto de 3 artefactos y checksums verificables.\n'
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
recipient="${BACKUP_AGE_RECIPIENT:-}"
profile="${BACKUP_PROFILE:-unknown}"
receipt_key="${BACKUP_RECEIPT_HMAC_KEY:-}"

[ -n "$backup_dir" ] || die "BACKUP_DIR está vacío"
[[ "$backup_dir" = /* ]] || die "BACKUP_DIR debe ser una ruta absoluta"
flotillas_verify_inherited_operation_lock "$backup_dir" || \
  die "backup.sh requiere el lock operativo heredado de predeploy-guard.sh o backup-public.sh"
[ -n "$recipient" ] || die "BACKUP_AGE_RECIPIENT está vacío"
[[ "$profile" != *[!A-Za-z0-9._-]* ]] || die "BACKUP_PROFILE contiene caracteres no permitidos"
if [ "$profile" = "public" ] && [ "${#receipt_key}" -lt 32 ]; then
  die "BACKUP_RECEIPT_HMAC_KEY es obligatorio y debe tener al menos 32 caracteres en public"
fi
if [ -n "$receipt_key" ] && [ "${#receipt_key}" -lt 32 ]; then
  die "BACKUP_RECEIPT_HMAC_KEY debe tener al menos 32 caracteres"
fi
if [ -n "$receipt_key" ] && receipt_key_is_placeholder "$receipt_key"; then
  die "BACKUP_RECEIPT_HMAC_KEY conserva un placeholder CAMBIA...; genera una clave real"
fi

for cmd in age awk chmod date grep mkdir mv rm sha256sum tar wc; do
  need_command "$cmd"
done
[ -z "$receipt_key" ] || need_command python3

# Defensa en profundidad: un backup coherente exige que no haya procesos que
# escriban DB/archivos. La guardia es quien los detiene y los restaura si falla.
if ! running_services="$("${compose[@]}" ps --services --status running)"; then
  die "no se pudo consultar el estado de servicios"
fi
for writer in api worker-python migrate; do
  if grep -Fxq "$writer" <<< "$running_services"; then
    die "el escritor '${writer}' sigue en ejecución; usa predeploy-guard.sh"
  fi
done

mkdir -p -- "$backup_dir"
chmod 700 "$backup_dir"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle_name="flotillas-${profile}-${stamp}"
partial_dir="${backup_dir}/.${bundle_name}.partial"
final_dir="${backup_dir}/${bundle_name}"
[ ! -e "$partial_dir" ] || die "ya existe el directorio parcial: ${partial_dir}"
[ ! -e "$final_dir" ] || die "ya existe el respaldo: ${final_dir}"
mkdir -m 700 -- "$partial_dir"

cleanup_partial() {
  if [ -n "${partial_dir:-}" ] && [ -d "$partial_dir" ]; then
    rm -rf -- "$partial_dir"
  fi
}
trap cleanup_partial EXIT

printf 'Validando dump PostgreSQL con pg_restore --list...\n' >&2
if ! db_toc_entries="$(
  "${compose[@]}" exec -T postgres sh -ceu \
    'exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' |
    "${compose[@]}" exec -T postgres sh -ceu 'exec pg_restore --list' |
    awk '!/^;/ && NF { count++ } END { print count + 0 }'
)"; then
  die "pg_dump/pg_restore no superó la validación básica"
fi
[[ "$db_toc_entries" =~ ^[0-9]+$ ]] || die "conteo TOC inválido: ${db_toc_entries}"

printf 'Validando archivos de uploads y reportes como TAR...\n' >&2
if ! uploads_entries="$(
  "${compose[@]}" run --rm --no-deps -T --user 0:0 --entrypoint sh api \
    -ceu 'test -d /app/uploads; exec tar -C /app/uploads -cf - .' |
    tar -tf - | awk 'NF { count++ } END { print count + 0 }'
)"; then
  die "uploads no superó la validación TAR"
fi
if ! reports_entries="$(
  "${compose[@]}" run --rm --no-deps -T --user 0:0 --entrypoint sh api \
    -ceu 'test -d /app/storage/reports; exec tar -C /app/storage/reports -cf - .' |
    tar -tf - | awk 'NF { count++ } END { print count + 0 }'
)"; then
  die "reports no superó la validación TAR"
fi

printf 'Cifrando PostgreSQL con age (sin copia intermedia en claro)...\n' >&2
if ! "${compose[@]}" exec -T postgres sh -ceu \
  'exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' |
  age --encrypt --recipient "$recipient" --output "${partial_dir}/database.dump.age"; then
  die "falló el dump cifrado de PostgreSQL"
fi

printf 'Cifrando uploads con age...\n' >&2
if ! "${compose[@]}" run --rm --no-deps -T --user 0:0 --entrypoint sh api \
  -ceu 'test -d /app/uploads; exec tar -C /app/uploads -cf - .' |
  age --encrypt --recipient "$recipient" --output "${partial_dir}/uploads.tar.age"; then
  die "falló el respaldo cifrado de uploads"
fi

printf 'Cifrando reportes con age...\n' >&2
if ! "${compose[@]}" run --rm --no-deps -T --user 0:0 --entrypoint sh api \
  -ceu 'test -d /app/storage/reports; exec tar -C /app/storage/reports -cf - .' |
  age --encrypt --recipient "$recipient" --output "${partial_dir}/reports.tar.age"; then
  die "falló el respaldo cifrado de reports"
fi

created_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_manifest "$partial_dir" "$created_utc" "$profile" \
  "$db_toc_entries" "$uploads_entries" "$reports_entries"
if ! age --encrypt --recipient "$recipient" --output "${partial_dir}/manifest.txt.age" \
  "${partial_dir}/manifest.txt"; then
  die "falló el cifrado del manifiesto"
fi
rm -f -- "${partial_dir}/manifest.txt"
write_encrypted_checksums "$partial_dir"
if [ -n "$receipt_key" ]; then
  BACKUP_RECEIPT_HMAC_KEY="$receipt_key" \
    python3 "${script_dir}/backup_receipt.py" create \
      --bundle-dir "$partial_dir" \
      --created-utc "$created_utc" \
      --profile "$profile" \
      --bundle-name "$bundle_name" >/dev/null || die "falló la firma HMAC del receipt"
fi
chmod 600 "${partial_dir}"/*

# `mv` dentro del mismo BACKUP_DIR publica el conjunto completo atómicamente.
mv -- "$partial_dir" "$final_dir"
partial_dir=""
trap - EXIT
printf '%s\n' "$final_dir"

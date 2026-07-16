#!/usr/bin/env bash
# Verifica un bundle cifrado y, opcionalmente, restaura PostgreSQL en una BD
# temporal vacía. Nunca escribe sobre POSTGRES_DB.
set -Eeuo pipefail
umask 077

die() {
  printf 'ERROR restore-check: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Uso:
  BACKUP_AGE_IDENTITY=/ruta/identity.txt \
    bash scripts/ops/verify-restore.sh --bundle /ruta/flotillas-... \
      [--list-only | --scratch-restore] -- docker compose ...
  bash scripts/ops/verify-restore.sh --check

--list-only (default): verifica hashes, descifra manifiesto, pg_restore --list
                       y lista/valida ambos TAR sin extraerlos.
--scratch-restore:     además crea una BD temporal vacía, restaura el dump,
                       comprueba relaciones y elimina esa BD.

La identidad age debe suministrarse de forma temporal desde almacenamiento
seguro; no debe guardarse en el servidor junto con los backups.
USAGE
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  scratch_example="flotillas_restore_verify_20000101t000000_1234"
  [[ "$scratch_example" =~ ^flotillas_restore_verify_[a-z0-9_]+$ ]]
  [ "${#scratch_example}" -le 63 ]
  printf 'OK verify-restore --check: nombre scratch seguro y modo no destructivo por defecto.\n'
  exit 0
fi

bundle_dir=""
mode="list-only"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle)
      [ "$#" -ge 2 ] || die "--bundle requiere una ruta"
      bundle_dir="$2"
      shift 2
      ;;
    --list-only)
      mode="list-only"
      shift
      ;;
    --scratch-restore)
      mode="scratch-restore"
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      usage >&2
      die "opción desconocida: $1"
      ;;
  esac
done

[ -n "$bundle_dir" ] || die "falta --bundle"
[ "$#" -gt 0 ] || die "falta el comando Docker Compose después de --"
compose=("$@")
identity="${BACKUP_AGE_IDENTITY:-}"

[ -d "$bundle_dir" ] || die "bundle inexistente: ${bundle_dir}"
[ -n "$identity" ] || die "BACKUP_AGE_IDENTITY está vacío"
[ -r "$identity" ] || die "identidad age no legible: ${identity}"

for cmd in age awk cut date grep mktemp rm sha256sum tar; do
  command -v "$cmd" >/dev/null 2>&1 || die "falta el comando requerido: ${cmd}"
done

required_files=(database.dump.age uploads.tar.age reports.tar.age manifest.txt.age encrypted.sha256)
for file in "${required_files[@]}"; do
  [ -f "${bundle_dir}/${file}" ] || die "falta artefacto: ${file}"
  [ ! -L "${bundle_dir}/${file}" ] || die "no se aceptan symlinks en el bundle: ${file}"
done

printf 'Verificando checksums de artefactos cifrados...\n' >&2
(
  cd "$bundle_dir"
  sha256sum --check encrypted.sha256
)

manifest_tmp="$(mktemp)"
scratch_db=""

cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "${scratch_db:-}" ]; then
    "${compose[@]}" exec -T postgres sh -ceu \
      'dropdb --if-exists --force --username="$POSTGRES_USER" "$1"' sh "$scratch_db" >/dev/null 2>&1 || \
      printf 'AVISO: no se pudo eliminar la BD temporal %s. Elimínala manualmente.\n' "$scratch_db" >&2
  fi
  rm -f -- "${manifest_tmp:-}"
  exit "$status"
}
trap cleanup EXIT

age --decrypt --identity "$identity" --output "$manifest_tmp" "${bundle_dir}/manifest.txt.age"
[ "$(grep -c '^format=flotillas-backup-v1$' "$manifest_tmp")" -eq 1 ] || \
  die "manifiesto con formato desconocido"
[ "$(grep -c '^consistency=application-writers-stopped$' "$manifest_tmp")" -eq 1 ] || \
  die "el manifiesto no declara snapshot con escritores detenidos"

manifest_value() {
  local key="$1"
  [ "$(grep -c "^${key}=" "$manifest_tmp")" -eq 1 ] || die "clave ausente/duplicada en manifiesto: ${key}"
  grep "^${key}=" "$manifest_tmp" | cut -d= -f2-
}

for artifact in database uploads reports; do
  expected_hash="$(manifest_value "artifact.${artifact}.sha256")"
  artifact_file="$(manifest_value "artifact.${artifact}.file")"
  case "${artifact}:${artifact_file}" in
    database:database.dump.age|uploads:uploads.tar.age|reports:reports.tar.age) ;;
    *) die "nombre de artefacto inesperado en manifiesto: ${artifact_file}" ;;
  esac
  actual_hash="$(sha256sum "${bundle_dir}/${artifact_file}" | awk '{print $1}')"
  [ "$actual_hash" = "$expected_hash" ] || die "hash del manifiesto no coincide para ${artifact}"
done

printf 'Descifrando dump para pg_restore --list...\n' >&2
if ! age --decrypt --identity "$identity" "${bundle_dir}/database.dump.age" |
  "${compose[@]}" exec -T postgres pg_restore --list >/dev/null; then
  die "el dump no pudo listarse con pg_restore"
fi

validate_tar() {
  local encrypted_tar="$1"
  if ! age --decrypt --identity "$identity" "$encrypted_tar" |
    tar -tf - |
    awk '
      /^\// { exit 1 }
      /(^|\/)\.\.(\/|$)/ { exit 1 }
      END { if (NR == 0) exit 1 }
    ' >/dev/null; then
    die "TAR inválido o con ruta insegura: ${encrypted_tar}"
  fi
}

printf 'Descifrando y validando índices TAR...\n' >&2
validate_tar "${bundle_dir}/uploads.tar.age"
validate_tar "${bundle_dir}/reports.tar.age"

if [ "$mode" = "scratch-restore" ]; then
  scratch_db="flotillas_restore_verify_$(date -u +%Y%m%dt%H%M%S)_$$"
  [[ "$scratch_db" =~ ^[a-z0-9_]+$ ]] || die "nombre temporal inválido"
  [ "${#scratch_db}" -le 63 ] || die "nombre temporal excede 63 caracteres"

  printf 'Creando BD temporal vacía %s...\n' "$scratch_db" >&2
  "${compose[@]}" exec -T postgres sh -ceu \
    'createdb --username="$POSTGRES_USER" "$1"' sh "$scratch_db"

  printf 'Restaurando dump en la BD temporal (nunca en POSTGRES_DB)...\n' >&2
  if ! age --decrypt --identity "$identity" "${bundle_dir}/database.dump.age" |
    "${compose[@]}" exec -T postgres sh -ceu \
      'exec pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$1"' \
      sh "$scratch_db"; then
    die "falló la restauración en la BD temporal"
  fi

  relations_sql="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r', 'p', 'm', 'S', 'v');"
  restored_relations="$(
    "${compose[@]}" exec -T postgres sh -ceu \
      'exec psql --username="$POSTGRES_USER" --dbname="$1" --no-align --tuples-only --quiet --command="$2"' \
      sh "$scratch_db" "$relations_sql"
  )"
  restored_relations="${restored_relations//[[:space:]]/}"
  [[ "$restored_relations" =~ ^[1-9][0-9]*$ ]] || \
    die "restore temporal terminó sin relaciones de aplicación"
  printf 'Restore temporal OK: %s relaciones; se eliminará %s.\n' "$restored_relations" "$scratch_db"
else
  printf 'Verificación list-only OK. Ejecuta --scratch-restore en un host controlado para probar restore real.\n'
fi

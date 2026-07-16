#!/usr/bin/env bash
# Prepara los bind mounts escritos por API/worker sin recurrir a chmod 777.
set -Eeuo pipefail

readonly DATA_ROOT="/srv/datos"
readonly APP_UID="10001"
readonly APP_GID="10001"
readonly DIR_MODE="0750"
readonly FILE_MODE="0640"

die() {
  printf 'ERROR storage preflight: %s\n' "$*" >&2
  exit 1
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  [[ "$APP_UID" =~ ^[0-9]+$ ]]
  [[ "$APP_GID" =~ ^[0-9]+$ ]]
  [ "$APP_UID" -ge 10000 ]
  [ "$DIR_MODE" = "0750" ]
  [ "$FILE_MODE" = "0640" ]
  printf 'OK prepare-staging-storage --check: UID/GID compartido 10001 y modos 0750/0640.\n'
  exit 0
fi

[ "$#" -eq 0 ] || die "uso: bash scripts/ops/prepare-staging-storage.sh [--check]"
command -v find >/dev/null 2>&1 || die "falta find"
command -v mountpoint >/dev/null 2>&1 || die "falta mountpoint"
command -v stat >/dev/null 2>&1 || die "falta stat"
mountpoint -q "$DATA_ROOT" || die "${DATA_ROOT} no está montado"

paths=("${DATA_ROOT}/flotillas/uploads" "${DATA_ROOT}/flotillas/reports")

repair_as_root() {
  local path
  for path in "${paths[@]}"; do
    install -d -o "$APP_UID" -g "$APP_GID" -m "$DIR_MODE" "$path"
    chown -hR "${APP_UID}:${APP_GID}" "$path"
    find "$path" -xdev -type d -exec chmod "$DIR_MODE" {} +
    find "$path" -xdev -type f -exec chmod "$FILE_MODE" {} +
  done
}

print_remediation() {
  cat >&2 <<'COMMANDS'
Ejecuta exactamente y vuelve a correr ./deploy.sh:
  sudo install -d -o 10001 -g 10001 -m 0750 /srv/datos/flotillas/uploads /srv/datos/flotillas/reports
  sudo chown -hR 10001:10001 /srv/datos/flotillas/uploads /srv/datos/flotillas/reports
  sudo find /srv/datos/flotillas/uploads /srv/datos/flotillas/reports -xdev -type d -exec chmod 0750 '{}' +
  sudo find /srv/datos/flotillas/uploads /srv/datos/flotillas/reports -xdev -type f -exec chmod 0640 '{}' +
No uses chmod 777.
COMMANDS
}

if [ "$EUID" -eq 0 ]; then
  command -v install >/dev/null 2>&1 || die "falta install"
  command -v chown >/dev/null 2>&1 || die "falta chown"
  command -v chmod >/dev/null 2>&1 || die "falta chmod"
  repair_as_root
fi

for path in "${paths[@]}"; do
  if [ ! -d "$path" ]; then
    print_remediation
    die "falta el directorio ${path}"
  fi
  root_owner="$(stat -c '%u:%g' "$path")"
  root_mode="$(stat -c '%a' "$path")"
  if [ "$root_owner" != "${APP_UID}:${APP_GID}" ] || [ "$root_mode" != "${DIR_MODE#0}" ]; then
    print_remediation
    die "${path} tiene ${root_owner} modo ${root_mode}; requerido ${APP_UID}:${APP_GID} modo ${DIR_MODE#0}"
  fi

  # Root normaliza y puede auditar todo el árbol. Un operador no-root podría no
  # atravesar 0750; la prueba real de escritura se hace luego dentro de API/worker.
  if [ "$EUID" -eq 0 ]; then
    bad_owner="$(find "$path" -xdev \( ! -uid "$APP_UID" -o ! -gid "$APP_GID" \) -print -quit)"
    bad_dir_mode="$(find "$path" -xdev -type d ! -perm "$DIR_MODE" -print -quit)"
    bad_file_mode="$(find "$path" -xdev -type f ! -perm "$FILE_MODE" -print -quit)"
    [ -z "$bad_owner$bad_dir_mode$bad_file_mode" ] || die "normalización incompleta bajo ${path}"
  fi
done

printf 'OK storage staging: uploads/reports pertenecen a 10001:10001 con modos 0750/0640.\n'

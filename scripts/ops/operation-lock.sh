#!/usr/bin/env bash
# Lock compartido por deploys y backups. Este archivo se carga con `source`.

readonly FLOTILLAS_OPERATION_LOCK_BASENAME=".flotillas-operation.lock"

flotillas_operation_lock_path() {
  local backup_dir="$1"
  printf '%s/%s\n' "${backup_dir%/}" "$FLOTILLAS_OPERATION_LOCK_BASENAME"
}

flotillas_acquire_operation_lock() {
  local backup_dir="$1"
  local lock_path

  [ -n "$backup_dir" ] || return 2
  [[ "$backup_dir" = /* ]] || return 2
  command -v flock >/dev/null 2>&1 || return 3
  command -v realpath >/dev/null 2>&1 || return 3

  mkdir -p -- "$backup_dir" || return 4
  [ ! -L "$backup_dir" ] || return 4
  chmod 700 "$backup_dir" || return 4

  lock_path="$(flotillas_operation_lock_path "$backup_dir")"
  [ ! -L "$lock_path" ] || return 4
  exec 9>"$lock_path" || return 4
  chmod 600 "$lock_path" || return 4
  flock -n 9 || return 5

  FLOTILLAS_OPERATION_LOCK_PATH="$(realpath -m "$lock_path")"
  FLOTILLAS_OPERATION_LOCK_FD=9
  export FLOTILLAS_OPERATION_LOCK_PATH FLOTILLAS_OPERATION_LOCK_FD
}

flotillas_verify_inherited_operation_lock() {
  local backup_dir="$1"
  local expected_path fd fd_path

  [ -n "$backup_dir" ] || return 2
  [[ "$backup_dir" = /* ]] || return 2
  command -v flock >/dev/null 2>&1 || return 3
  command -v readlink >/dev/null 2>&1 || return 3
  command -v realpath >/dev/null 2>&1 || return 3

  expected_path="$(realpath -m "$(flotillas_operation_lock_path "$backup_dir")")"
  [ "${FLOTILLAS_OPERATION_LOCK_PATH:-}" = "$expected_path" ] || return 6
  fd="${FLOTILLAS_OPERATION_LOCK_FD:-}"
  [[ "$fd" =~ ^[0-9]+$ ]] || return 6
  [ -e "/proc/$$/fd/${fd}" ] || return 6
  fd_path="$(readlink -f "/proc/$$/fd/${fd}")" || return 6
  [ "$fd_path" = "$expected_path" ] || return 6

  # Reaplicar flock sobre la descripción heredada confirma que el descriptor
  # sigue abierto; no crea un segundo lock independiente.
  flock -n "$fd" || return 6
}

flotillas_operation_lock_self_check() {
  local temporary_dir competing_status symlink_status symlink_target
  FLOTILLAS_OPERATION_LOCK_CHECK_TMP_DIR="$(mktemp -d)"
  temporary_dir="$FLOTILLAS_OPERATION_LOCK_CHECK_TMP_DIR"
  trap 'rm -rf -- "${FLOTILLAS_OPERATION_LOCK_CHECK_TMP_DIR:-}"' EXIT

  flotillas_acquire_operation_lock "$temporary_dir" || return 1
  flotillas_verify_inherited_operation_lock "$temporary_dir" || return 1

  # Un symlink debe rechazarse antes de chmod: de otro modo una configuración
  # errónea podría cambiar permisos del destino aun cuando el lock aborte.
  symlink_target="${temporary_dir}/symlink-target"
  mkdir -m 755 -- "$symlink_target"
  ln -s "$symlink_target" "${temporary_dir}/symlink-backup"
  if flotillas_acquire_operation_lock "${temporary_dir}/symlink-backup"; then
    return 1
  else
    symlink_status=$?
  fi
  [ "$symlink_status" -eq 4 ] || return 1
  [ "$(stat -c '%a' "$symlink_target")" = "755" ] || return 1

  set +e
  bash -c '
    source "$1"
    flotillas_acquire_operation_lock "$2"
  ' bash "${BASH_SOURCE[0]}" "$temporary_dir"
  competing_status=$?
  set -e
  [ "$competing_status" -eq 5 ] || return 1

  bash -c '
    source "$1"
    flotillas_verify_inherited_operation_lock "$2"
  ' bash "${BASH_SOURCE[0]}" "$temporary_dir" || return 1

  rm -rf -- "$temporary_dir"
  FLOTILLAS_OPERATION_LOCK_CHECK_TMP_DIR=""
  trap - EXIT
  printf 'OK operation-lock --check: exclusión mutua e herencia verificadas.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -Eeuo pipefail
  [ "${1:-}" = "--check" ] || {
    printf 'Uso: bash scripts/ops/operation-lock.sh --check\n' >&2
    exit 2
  }
  flotillas_operation_lock_self_check
fi

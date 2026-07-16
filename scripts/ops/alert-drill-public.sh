#!/usr/bin/env bash
# Simulacro controlado de alerta. Solo detiene api o worker-python tras una
# confirmación literal y restaura siempre el servicio mediante trap.
set -Eeuo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/../.." && pwd)"
cd "$root_dir"

die() {
  printf 'ERROR alert-drill-public: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Uso:
  bash scripts/ops/alert-drill-public.sh --service api \
    --confirm HETZNER_ALERT_DRILL [--env-file /ruta/.env]
  bash scripts/ops/alert-drill-public.sh --service worker-python \
    --confirm HETZNER_ALERT_DRILL [--env-file /ruta/.env]
  bash scripts/ops/alert-drill-public.sh --check

Requiere una línea base sana y OPS_ALERT_WEBHOOK_URL configurado. Nunca acepta
otros servicios y restaura el que estaba running aunque haya error o señal.
USAGE
}

allowed_service() {
  case "$1" in api|worker-python) return 0 ;; *) return 1 ;; esac
}

self_check() {
  allowed_service api
  allowed_service worker-python
  ! allowed_service postgres
  [ "HETZNER_ALERT_DRILL" = "HETZNER_ALERT_DRILL" ]
  printf 'OK alert-drill-public --check: allowlist y confirmación explícita verificadas.\n'
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  self_check
  exit 0
fi

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

env_file=".env"
service=""
confirmation=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      [ "$#" -ge 2 ] || die "--env-file requiere una ruta"
      env_file="$2"
      shift 2
      ;;
    --service)
      [ "$#" -ge 2 ] || die "--service requiere un valor"
      service="$2"
      shift 2
      ;;
    --confirm)
      [ "$#" -ge 2 ] || die "--confirm requiere la frase literal"
      confirmation="$2"
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

allowed_service "$service" || die "--service solo acepta api o worker-python"
[ "$confirmation" = "HETZNER_ALERT_DRILL" ] || \
  die "falta --confirm HETZNER_ALERT_DRILL"
if [[ "$env_file" != /* ]]; then
  env_file="${root_dir}/${env_file}"
fi
[ -f "$env_file" ] || die "env file inexistente: ${env_file}"
[ ! -L "$env_file" ] || die "el env file no puede ser symlink"
webhook="${OPS_ALERT_WEBHOOK_URL:-$(read_env_setting OPS_ALERT_WEBHOOK_URL "$env_file")}"
[ -n "$webhook" ] || die "OPS_ALERT_WEBHOOK_URL debe estar configurado para probar entrega"

for command_name in docker grep python3 sed seq sleep tail; do
  command -v "$command_name" >/dev/null 2>&1 || die "falta el comando: ${command_name}"
done

compose=(
  docker compose --env-file "$env_file" -p flotillas
  -f docker-compose.yml -f docker-compose.public.yml
)
"${compose[@]}" config --quiet
running_services="$("${compose[@]}" ps --services --status running)"
grep -Fxq "$service" <<< "$running_services" || die "${service} no estaba running; simulacro cancelado"

run_monitor() {
  python3 "${script_dir}/public_monitor.py" --env-file "$env_file"
}

service_is_healthy() {
  case "$service" in
    api)
      "${compose[@]}" exec -T api \
        wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1
      ;;
    worker-python)
      "${compose[@]}" exec -T worker-python \
        python healthcheck.py >/dev/null 2>&1
      ;;
  esac
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 60); do
    if service_is_healthy; then
      return 0
    fi
    sleep 3
  done
  return 1
}

needs_restore=0
needs_recovery=0

restore_target() {
  [ "$needs_restore" -eq 1 ] || return 0
  printf 'Restaurando %s...\n' "$service" >&2
  "${compose[@]}" start "$service" >/dev/null
  wait_for_health || return 1
  needs_restore=0
}

cleanup_on_exit() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$needs_restore" -eq 1 ]; then
    restore_target || {
      printf 'ERROR alert-drill-public: %s no recuperó health; intervención requerida.\n' "$service" >&2
      status=1
    }
  fi
  if [ "$needs_recovery" -eq 1 ] && [ "$needs_restore" -eq 0 ]; then
    printf 'Emitiendo comprobación final/recovery tras cleanup...\n' >&2
    run_monitor >/dev/null || status=1
  fi
  exit "$status"
}
trap cleanup_on_exit EXIT
trap 'exit 130' INT TERM

printf 'Comprobando línea base operativa...\n' >&2
if ! run_monitor; then
  die "el monitor no estaba sano antes del simulacro; no se detiene ningún servicio"
fi

stop_timeout=30
[ "$service" = "worker-python" ] && stop_timeout=120
printf 'Deteniendo %s de forma controlada...\n' "$service" >&2
needs_restore=1
"${compose[@]}" stop --timeout "$stop_timeout" "$service" >/dev/null
needs_recovery=1

printf 'Esperando status=degraded y entrega de alerta...\n' >&2
if run_monitor; then
  degraded_status=0
else
  degraded_status=$?
fi
[ "$degraded_status" -eq 1 ] || \
  die "se esperaba exit 1; se obtuvo ${degraded_status} (2 indica fallo de monitor/webhook)"

restore_target || die "${service} no recuperó su healthcheck"

printf 'Esperando status=ok y webhook de recuperación...\n' >&2
if ! run_monitor; then
  die "el monitor final no regresó a estado sano"
fi
needs_recovery=0
trap - EXIT INT TERM
printf 'OK alert drill %s: alerta, restauración, health y recovery verificados.\n' "$service"

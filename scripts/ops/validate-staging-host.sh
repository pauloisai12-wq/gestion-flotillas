#!/usr/bin/env bash
# Valida en el host el estado efectivo del perfil staging: bind de Caddy solo a
# WireGuard, servicios internos sin puertos, mounts LUKS y red Compose exclusiva.
set -Eeuo pipefail

readonly PROJECT="flotillas"
readonly EXPECTED_NETWORK="flotillas_default"
readonly DATA_ROOT="/srv/datos"
readonly BACKUP_ROOT="/srv/backups"
readonly EXPECTED_CADDY_BIND="10.10.0.2:8443"

die() {
  printf 'ERROR validación host: %s\n' "$*" >&2
  exit 1
}

classify_luks() {
  local block_types="$1"
  local manual_override="$2"
  if grep -Fxq crypt <<< "$block_types"; then
    printf 'VERIFIED\n'
  elif [ -n "$block_types" ]; then
    printf 'RESOLVED_UNENCRYPTED\n'
  elif [ "$manual_override" = "I_CONFIRMED_ENCRYPTION_THIS_RUN" ]; then
    printf 'MANUAL_UNRESOLVED\n'
  else
    printf 'UNRESOLVED\n'
  fi
}

if [ "${1:-}" = "--check" ] || [ "${1:-}" = "--self-test" ]; then
  [ "$PROJECT" = "flotillas" ]
  [ "$EXPECTED_NETWORK" = "${PROJECT}_default" ]
  [[ "$DATA_ROOT" = /* ]]
  [[ "$BACKUP_ROOT" = /* ]]
  [[ "$EXPECTED_CADDY_BIND" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$ ]]
  [ "$(classify_luks $'lvm\ncrypt\npart' '')" = "VERIFIED" ]
  [ "$(classify_luks $'lvm\npart' 'I_CONFIRMED_ENCRYPTION_THIS_RUN')" = "RESOLVED_UNENCRYPTED" ]
  [ "$(classify_luks '' 'I_CONFIRMED_ENCRYPTION_THIS_RUN')" = "MANUAL_UNRESOLVED" ]
  [ "$(classify_luks '' '')" = "UNRESOLVED" ]
  printf 'OK validate-staging-host --check: contrato estático válido; no se consultó Docker/host.\n'
  exit 0
fi

[ "${1:-}" = "--" ] || die "uso: bash scripts/ops/validate-staging-host.sh -- docker compose ..."
shift
[ "$#" -gt 0 ] || die "falta el comando Docker Compose después de --"
compose=("$@")

command -v docker >/dev/null 2>&1 || die "docker no está instalado"
command -v findmnt >/dev/null 2>&1 || die "findmnt no está instalado"
command -v lsblk >/dev/null 2>&1 || die "lsblk no está instalado"
command -v mountpoint >/dev/null 2>&1 || die "mountpoint no está instalado"
command -v stat >/dev/null 2>&1 || die "stat no está instalado"
mountpoint -q "$DATA_ROOT" || die "${DATA_ROOT} no es un mountpoint activo"
mountpoint -q "$BACKUP_ROOT" || die "${BACKUP_ROOT} no es un mountpoint activo"
data_source="$(findmnt -nro SOURCE --target "$DATA_ROOT" 2>/dev/null || true)"
data_source_device="$(printf '%s' "$data_source" | sed 's/\[.*$//')"
data_block_types=""
if [[ "$data_source_device" = /dev/* ]]; then
  data_block_types="$(lsblk -sno TYPE "$data_source_device" 2>/dev/null | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' || true)"
fi
luks_decision="$(classify_luks "$data_block_types" "${FLOTILLAS_ALLOW_UNRESOLVED_LUKS:-}")"
case "$luks_decision" in
  VERIFIED) ;;
  RESOLVED_UNENCRYPTED) die "${DATA_ROOT} no tiene un ancestro TYPE=crypt: ${data_block_types//$'\n'/, }" ;;
  MANUAL_UNRESOLVED) printf 'AVISO: backing LUKS no resoluble aceptado solo por confirmación de esta ejecución.\n' >&2 ;;
  UNRESOLVED) die "no se pudo resolver backing LUKS de ${DATA_ROOT}; usa la excepción manual documentada solo tras verificar cifrado" ;;
esac
data_device="$(stat -c '%d' "$DATA_ROOT")"
backup_device="$(stat -c '%d' "$BACKUP_ROOT")"
[ "$data_device" != "$backup_device" ] || \
  die "${DATA_ROOT} y ${BACKUP_ROOT} comparten filesystem/dispositivo"

container_id() {
  local service="$1"
  local id
  id="$("${compose[@]}" ps -q "$service")"
  [ -n "$id" ] || die "servicio sin contenedor activo: ${service}"
  printf '%s\n' "$id"
}

assert_project_and_network() {
  local service="$1"
  local id project_label networks
  id="$(container_id "$service")"
  project_label="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$id")"
  [ "$project_label" = "$PROJECT" ] || die "${service} pertenece al proyecto '${project_label}', no '${PROJECT}'"
  networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$id" | tr -d '\r' | sed '/^$/d')"
  [ "$networks" = "$EXPECTED_NETWORK" ] || die "${service} está conectado a redes inesperadas: ${networks}"
}

assert_no_published_ports() {
  local service="$1"
  local id published
  id="$(container_id "$service")"
  published="$(docker port "$id" 2>/dev/null || true)"
  [ -z "$published" ] || die "${service} publica puertos al host: ${published}"
}

assert_bind_mount() {
  local service="$1"
  local destination="$2"
  local expected_source="$3"
  local id actual
  id="$(container_id "$service")"
  actual="$(
    docker inspect --format "{{range .Mounts}}{{if eq .Destination \"${destination}\"}}{{println .Type \"|\" .Source}}{{end}}{{end}}" "$id" |
      tr -d '\r' | sed '/^$/d'
  )"
  [ "$actual" = "bind | ${expected_source}" ] || \
    die "mount ${service}:${destination} esperado 'bind | ${expected_source}', efectivo '${actual}'"
}

services=(postgres redis api web worker-python caddy)
for service in "${services[@]}"; do
  assert_project_and_network "$service"
done

for service in postgres redis api web worker-python; do
  assert_no_published_ports "$service"
done

caddy_id="$(container_id caddy)"
caddy_publish="$(docker port "$caddy_id" 443/tcp 2>/dev/null | tr -d '\r')"
[ "$caddy_publish" = "$EXPECTED_CADDY_BIND" ] || \
  die "Caddy 443/tcp debe publicar solo ${EXPECTED_CADDY_BIND}; efectivo '${caddy_publish}'"
caddy_all_ports="$(docker port "$caddy_id" 2>/dev/null | tr -d '\r')"
[ "$caddy_all_ports" = "443/tcp -> ${EXPECTED_CADDY_BIND}" ] || \
  die "Caddy tiene publicaciones adicionales o inesperadas: ${caddy_all_ports}"

assert_bind_mount postgres /var/lib/postgresql/data /srv/datos/flotillas/postgres
assert_bind_mount redis /data /srv/datos/flotillas/redis
assert_bind_mount api /app/uploads /srv/datos/flotillas/uploads
assert_bind_mount api /app/storage/reports /srv/datos/flotillas/reports
assert_bind_mount worker-python /app/storage/reports /srv/datos/flotillas/reports
assert_bind_mount caddy /data /srv/datos/flotillas/caddy/data
assert_bind_mount caddy /config /srv/datos/flotillas/caddy/config

# La red del proyecto no debe contener al servicio vecino ni contenedores
# manuales. Se valida la etiqueta efectiva de cada miembro, no solo el YAML.
if ! network_members="$(docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' "$EXPECTED_NETWORK")"; then
  die "no se pudo inspeccionar la red ${EXPECTED_NETWORK}"
fi
while IFS= read -r member; do
  [ -n "$member" ] || continue
  member_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$member")"
  [ "$member_project" = "$PROJECT" ] || \
    die "contenedor ajeno '${member}' conectado a ${EXPECTED_NETWORK} (proyecto='${member_project}')"
done <<< "$network_members"

printf 'OK host staging: puertos, bind mounts, proyecto y red efectiva verificados.\n'

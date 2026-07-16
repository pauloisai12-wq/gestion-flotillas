#!/usr/bin/env bash
# PERFIL LEGADO: no usar para el entorno vigente.
# Produccion/QA publico corre en Hetzner Cloud mediante ./deploy-public.sh.
#
# deploy.sh — despliegue de un solo comando para flotillas-v2 (QA/Staging).
#
# Encapsula la secuencia correcta para el servidor de casa (VPN + Caddy interno,
# NODE_ENV=production) SIN que el operador deba recordar ningún paso manual:
#   - valida que exista .env y que no queden placeholders sin reemplazar,
#   - exige Docker Compose >= 2.24 (el override usa `!reset []`),
#   - build de imágenes dentro de Docker,
#   - levanta dependencias y espera a que estén healthy,
#   - el servicio one-shot `migrate` aplica `prisma migrate deploy` ANTES de
#     servir tráfico (definido en docker-compose.staging.yml),
#   - smoke test de /api/health.
#
# NO contiene secretos. Es idempotente: re-ejecutarlo converge el stack.
# La lógica compartida con deploy-public.sh vive en deploy-common.sh.
# Uso:   ./deploy.sh
set -Eeuo pipefail

# Ejecutar siempre desde la raíz del repo (donde viven .env y los compose).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Configuración específica de staging (consumida por deploy-common.sh) ────
readonly SCRIPT_NAME="deploy.sh"
readonly ENV_TEMPLATE="env.staging.plantilla.txt"
readonly COMPOSE_OVERRIDE="docker-compose.staging.yml"
readonly COMPOSE_OLD_DIE_MSG="actualiza Compose y reintenta; no se permite publicar servicios internos como fallback."
readonly BACKUP_PROFILE="staging"
readonly DEFAULT_BACKUP_DIR="/srv/backups/flotillas"
readonly DEFAULT_BACKUP_REQUIRE_MOUNT="/srv/backups"
readonly PRIMARY_DATA_MOUNT="/srv/datos"
# Staging persiste Postgres/Redis/uploads/reports en el disco cifrado LUKS bajo
# /srv/datos (bind mounts del override). deploy-common.sh aborta si NO está montado,
# para no inicializar una base fantasma vacía en el disco raíz.
readonly REQUIRE_MOUNT="/srv/datos"
readonly REQUIRE_LUKS_BACKING="true"

# Ayuda mostrada si Docker Compose es < 2.24 (Gotcha 3: `ports: !reset []`).
gotcha_reset_help() {
  cat >&2 <<'GOTCHA3'

  El override docker-compose.staging.yml usa `ports: !reset []`, que requiere
  Compose >= 2.24. Actualiza Docker Compose antes de continuar. Publicar
  postgres/redis/api/web, incluso en la IP VPN, no es un fallback aceptado.
GOTCHA3
}

# API y worker usan el mismo UID/GID numérico en staging para compartir reports.
# Como usuario no-root solo verifica; si falta ownership imprime comandos sudo
# exactos. Como root repara idempotentemente, nunca abre permisos 777.
prepare_persistent_storage() {
  bash ./scripts/ops/prepare-staging-storage.sh
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh api -ceu '
    upload_probe="/app/uploads/.flotillas-write-probe-$$"
    report_probe="/app/storage/reports/.flotillas-api-write-probe-$$"
    trap '\''rm -f "$upload_probe" "$report_probe"'\'' EXIT
    : > "$upload_probe"
    : > "$report_probe"
  '
  "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh worker-python -ceu '
    report_probe="/app/storage/reports/.flotillas-worker-write-probe-$$"
    trap '\''rm -f "$report_probe"'\'' EXIT
    : > "$report_probe"
  '
}

# ── Pasos comunes (validar .env, Compose, build, migrate, smoke test) ───────
source ./deploy-common.sh

# Verifica el estado EFECTIVO del host tras el up, no solo el YAML: Caddy solo
# en WireGuard, servicios internos sin ports, mounts LUKS y red sin vecinos.
step "Validando puertos, mounts e aislamiento efectivos de staging"
bash ./scripts/ops/validate-staging-host.sh -- "${COMPOSE[@]}"

# ── Banner final (específico de staging) ────────────────────────────────────
cat <<EOF

$(c_grn "Stack arriba.")  Acceso (solo por VPN):  https://flotillas.internal:8443

Siguientes pasos (una vez):
  - Crear el primer ADMIN (la BD arranca vacía; el seed demo está bloqueado en prod):
      ${COMPOSE[*]} run --rm \\
        -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='UnaPasswordFuerte12+' \\
        api node dist/scripts/bootstrap-admin.js
  - Exportar la CA interna de Caddy para distribuir a los revisores:
      ${COMPOSE[*]} cp flotillas_caddy:/data/caddy/pki/authorities/local/root.crt ./flotillas-caddy-root.crt
  - Asegurar la resolución  flotillas.internal -> 10.10.0.2  en cada cliente.
  - (Opcional, BD vacía) datos demo:
      ${COMPOSE[*]} run --rm -e NODE_ENV=development api npx prisma db seed
EOF

#!/usr/bin/env bash
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
readonly COMPOSE_OLD_DIE_MSG="actualiza Compose o aplica el fallback de puertos y reintenta."

# Ayuda mostrada si Docker Compose es < 2.24 (Gotcha 3: `ports: !reset []`).
gotcha_reset_help() {
  cat >&2 <<'GOTCHA3'

  El override docker-compose.staging.yml usa `ports: !reset []`, que requiere
  Compose >= 2.24. NO lo aplico automáticamente. Opciones:
    a) Actualiza Docker Compose a >= 2.24 (recomendado), o
    b) edita docker-compose.staging.yml y reemplaza cada `ports: !reset []`
       por un bind a la IP VPN, p.ej.:
           ports:
             - "10.10.0.2:5432:5432"
       (postgres/redis/api/web) — manteniéndolos en la interfaz WireGuard.
GOTCHA3
}

# ── Pasos comunes (validar .env, Compose, build, migrate, smoke test) ───────
source ./deploy-common.sh

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

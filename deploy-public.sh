#!/usr/bin/env bash
#
# deploy-public.sh — despliegue de un solo comando para flotillas-v2 en un VPS
# PÚBLICO (QA abierto, HTTPS Let's Encrypt). Hermano de deploy.sh (servidor de casa).
#
# Encapsula la secuencia correcta para un VPS dedicado expuesto a internet
# (NODE_ENV=production, Caddy en 0.0.0.0:80/443 con cert automático) SIN que el
# operador deba recordar pasos manuales:
#   - valida que exista .env y que no queden placeholders sin reemplazar,
#   - exige Docker Compose >= 2.24 (el override usa `!reset []`),
#   - build de imágenes dentro de Docker,
#   - levanta dependencias y espera a que estén healthy,
#   - el servicio one-shot `migrate` aplica `prisma migrate deploy` ANTES de
#     servir tráfico (definido en docker-compose.public.yml),
#   - smoke test de /api/health.
#
# NO contiene secretos. Es idempotente: re-ejecutarlo converge el stack.
# La lógica compartida con deploy.sh vive en deploy-common.sh.
# Uso:   ./deploy-public.sh
set -Eeuo pipefail

# Ejecutar siempre desde la raíz del repo (donde viven .env y los compose).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Configuración específica del VPS público (consumida por deploy-common.sh) ─
readonly SCRIPT_NAME="deploy-public.sh"
readonly ENV_TEMPLATE=".env.public.example"
readonly COMPOSE_OVERRIDE="docker-compose.public.yml"
readonly COMPOSE_OLD_DIE_MSG="actualiza Compose y reintenta."

# Ayuda mostrada si Docker Compose es < 2.24 (`ports: !reset []`).
gotcha_reset_help() {
  cat >&2 <<'GOTCHA3'

  El override docker-compose.public.yml usa `ports: !reset []`, que requiere
  Compose >= 2.24. NO lo aplico automáticamente. Opciones:
    a) Actualiza Docker Compose a >= 2.24 (recomendado;  curl -fsSL https://get.docker.com | sh), o
    b) edita docker-compose.public.yml y elimina cada servicio que lleva
       `ports: !reset []` SI ese servicio no hereda puertos problemáticos.
GOTCHA3
}

# ── Pasos comunes (validar .env, Compose, build, migrate, smoke test) ───────
source ./deploy-common.sh

# ── Banner final (específico del VPS público) ───────────────────────────────
# Dominio público leído del .env (CORS_ALLOWED_ORIGINS) para el banner.
public_url="$(grep -E '^CORS_ALLOWED_ORIGINS=' "$ENV_FILE" | head -1 | cut -d= -f2- | cut -d, -f1)"
cat <<EOF

$(c_grn "Stack arriba.")  Acceso público:  ${public_url:-https://<tu-dominio>}

Si es el primer arranque, dale a Caddy ~30s para emitir el certificado:
    ${COMPOSE[*]} logs caddy | grep -i "certificate obtained"

Siguientes pasos (una vez):
  - Datos demo para QA (dashboards poblados; usa contraseñas FUERTES):
      ${COMPOSE[*]} run --rm -e NODE_ENV=development \\
        -e SEED_ADMIN_PASSWORD='...' -e SEED_SUPER_PASSWORD='...' \\
        -e SEED_EXECUTOR_PASSWORD='...' -e SEED_WORKSHOP_PASSWORD='...' \\
        api npx prisma db seed
  - (Alternativa sin demo) crear solo el primer ADMIN (la BD arranca vacía):
      ${COMPOSE[*]} run --rm \\
        -e ADMIN_EMAIL=tu@correo.com -e ADMIN_PASSWORD='UnaPasswordFuerte12+' \\
        api node dist/scripts/bootstrap-admin.js
  - Comparte las credenciales con los revisores fuera de banda.
EOF

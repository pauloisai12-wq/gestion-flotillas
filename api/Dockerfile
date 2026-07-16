# /api/Dockerfile — multi-stage build (dev + prod)
# Uso:
#   - Dev (con hot-reload via docker-compose):  docker build --target dev -t flotillas-api:dev .
#   - Prod:                                      docker build --target prod -t flotillas-api:prod .

# ─── STAGE 1: dependencias compartidas ───────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# Toolchain para compilar módulos nativos (bcrypt) desde fuente: en Alpine (musl)
# no existe binario precompilado de bcrypt, así que node-pre-gyp compila.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
# npm ci respeta el lockfile exactamente y es más rápido que npm install
RUN npm ci --engine-strict

# ─── STAGE 2: build (TypeScript → JS + Prisma client) ────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate || true
RUN npm run build

# ─── STAGE 3: imagen de desarrollo (hot-reload con tsx watch) ────
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate || true
EXPOSE 3001
CMD ["npm", "run", "dev"]

# ─── STAGE 4: imagen de producción (slim, solo runtime deps) ─────
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

# Solo dependencias de runtime. El toolchain se instala como paquete virtual
# para compilar bcrypt y se elimina después (imagen final slim).
COPY package*.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev --engine-strict && npm cache clean --force \
  && apk del .build-deps

# Artefactos compilados
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Usuario no-root estable en ambos perfiles. UID/GID 10001 coincide con worker
# para compartir reports y con el preflight de bind mounts de staging.
RUN addgroup -S -g 10001 appgroup \
  && adduser -S -D -u 10001 -G appgroup -h /home/api api \
  && mkdir -p \
    /app/uploads/documents \
    /app/uploads/maintenance \
    /app/uploads/maintenance-tickets/photos \
    /app/uploads/maintenance-tickets/quotes \
    /app/uploads/qa-externa/buffalo \
    /app/uploads/qa-externa/lx \
    /app/storage/reports \
    /home/api \
  && chown -R api:appgroup /app /home/api
ENV HOME=/home/api
USER api

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]

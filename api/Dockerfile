# /api/Dockerfile — multi-stage build (dev + prod)
# Uso:
#   - Dev (con hot-reload via docker-compose):  docker build --target dev -t flotillas-api:dev .
#   - Prod:                                      docker build --target prod -t flotillas-api:prod .

# ─── STAGE 1: dependencias compartidas ───────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# npm ci respeta el lockfile exactamente y es más rápido que npm install
RUN npm ci

# ─── STAGE 2: build (TypeScript → JS + Prisma client) ────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate || true
RUN npm run build

# ─── STAGE 3: imagen de desarrollo (hot-reload con tsx watch) ────
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate || true
EXPOSE 3001
CMD ["npm", "run", "dev"]

# ─── STAGE 4: imagen de producción (slim, solo runtime deps) ─────
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

# Solo dependencias de runtime
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Artefactos compilados
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Usuario no-root por seguridad
RUN addgroup -S nodejs && adduser -S api -G nodejs && chown -R api:nodejs /app
USER api

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]

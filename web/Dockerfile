# /web/Dockerfile — multi-stage build (dev + prod)
# Uso:
#   - Dev:   docker build --target dev -t flotillas-web:dev .
#   - Prod:  docker build --target prod -t flotillas-web:prod .

# ─── STAGE 1: dependencias ──────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json .npmrc* ./
RUN npm ci

# ─── STAGE 2: build (Next.js production build) ──────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Build args: next.config.ts evalúa estas vars EN BUILD TIME, no en runtime,
# y el resultado queda hardcoded en routes-manifest.json. Por eso DEBEN pasarse
# aquí (no como env del container final) o los rewrites apuntarán a localhost.
ARG API_PROXY_TARGET=http://api:3001
ENV API_PROXY_TARGET=$API_PROXY_TARGET

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── STAGE 3: imagen de desarrollo ──────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ─── STAGE 4: imagen de producción (standalone, mínima) ─────────
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario no-root
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Output standalone: Next.js empaqueta server.js + solo las deps que realmente usa.
# La imagen final pasa de ~1.5GB a ~200MB y arranca en 1-2 segundos.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]

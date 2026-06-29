# ─── Stage 1: Install & Build ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (layer cache)
COPY package.json ./
RUN npm install --no-package-lock

# Copy source (note: .dockerignore excludes .dev.vars and node_modules)
COPY . .

# Build — Cloudflare Vite plugin produces Pages-compatible output in dist/
RUN npm run build

# ─── Stage 2: Production Runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN addgroup -g 1001 -S jarvis && adduser -S jarvis -u 1001 -G jarvis

WORKDIR /app

# Copy built output + wrangler config + node_modules (wrangler lives there)
COPY --from=builder --chown=jarvis:jarvis /app/dist        ./dist
COPY --from=builder --chown=jarvis:jarvis /app/node_modules ./node_modules
COPY --chown=jarvis:jarvis wrangler.jsonc ./
COPY --chown=jarvis:jarvis docker-entrypoint.sh ./

RUN chmod +x ./docker-entrypoint.sh

USER jarvis

# Port 8888 — non-standard to avoid conflicts (3000/5000/8000/8080 taken elsewhere)
EXPOSE 8888

ENTRYPOINT ["./docker-entrypoint.sh"]

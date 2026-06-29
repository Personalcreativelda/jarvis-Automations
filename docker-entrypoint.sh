#!/bin/sh
set -e

# Injeta variáveis de ambiente do Docker/Coolify no ficheiro .dev.vars
# que o wrangler lê automaticamente como bindings/vars do Worker.
printf '' > .dev.vars

if [ -n "$ELEVENLABS_API_KEY" ]; then
  printf 'ELEVENLABS_API_KEY=%s\n' "$ELEVENLABS_API_KEY" >> .dev.vars
fi

# Determina o directório de assets estáticos.
# O build do @cloudflare/vite-plugin + TanStack Start produz:
#   dist/client/  → assets estáticos
#   dist/server/  → bundle do Cloudflare Worker
# Se dist/client existir, usa-o; caso contrário usa dist/ directamente.
if [ -d "dist/client" ]; then
  STATIC_DIR="dist/client"
  WORKER_SCRIPT="dist/server/index.js"
else
  STATIC_DIR="dist"
  WORKER_SCRIPT=""
fi

# Flags de compatibilidade — têm de corresponder ao wrangler.jsonc
COMPAT_DATE="2025-09-24"
COMPAT_FLAGS="nodejs_compat"

if [ -n "$WORKER_SCRIPT" ] && [ -f "$WORKER_SCRIPT" ]; then
  # Modo Pages com worker explícito
  exec npx wrangler pages dev "$STATIC_DIR" \
    --compatibility-date "$COMPAT_DATE" \
    --compatibility-flags "$COMPAT_FLAGS" \
    --port 8888 \
    --ip 0.0.0.0
else
  # Fallback: serve dist/ directamente (worker em dist/_worker.js se existir)
  exec npx wrangler pages dev "$STATIC_DIR" \
    --compatibility-date "$COMPAT_DATE" \
    --compatibility-flags "$COMPAT_FLAGS" \
    --port 8888 \
    --ip 0.0.0.0
fi

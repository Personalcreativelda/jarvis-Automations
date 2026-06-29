# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline

COPY . .
RUN npm run build

# 'serve' é um servidor HTTP estático simples — sem Wrangler, sem wrangler preview
RUN npm install -g serve

EXPOSE 3000

# -s  → modo SPA: todas as rotas desconhecidas redirecionam para index.html
# -l  → porta de escuta
CMD ["serve", "-s", "dist/client", "-l", "3000"]

# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline

COPY . .
RUN npm run build

RUN npm install -g serve

EXPOSE 3000

# Vite SPA puro — serve ficheiros estáticos de dist/
CMD ["serve", "-s", "dist", "-l", "3000"]

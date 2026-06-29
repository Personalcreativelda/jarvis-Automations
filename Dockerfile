# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline

COPY . .

# VITE_ELEVENLABS_API_KEY é baked no bundle durante o build
# Define em Coolify → Build Variables (não Runtime)
ARG VITE_ELEVENLABS_API_KEY
ENV VITE_ELEVENLABS_API_KEY=$VITE_ELEVENLABS_API_KEY

RUN npm run build

RUN npm install -g serve

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]

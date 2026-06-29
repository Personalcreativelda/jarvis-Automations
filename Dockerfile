# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

COPY package.json ./

# Cache mount: os pacotes ficam em cache entre deploys — só re-instala o que mudou
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline

COPY . .

RUN --mount=type=cache,target=/root/.npm \
    npm run build

EXPOSE 8888

CMD ["sh", "-c", "[ -n \"$ELEVENLABS_API_KEY\" ] && echo \"ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY\" > .dev.vars; npx vite preview --port 8888 --host 0.0.0.0"]

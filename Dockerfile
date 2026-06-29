# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "[ -n \"$ELEVENLABS_API_KEY\" ] && echo \"ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY\" > .dev.vars; npx vite preview --port 3000 --host 0.0.0.0"]

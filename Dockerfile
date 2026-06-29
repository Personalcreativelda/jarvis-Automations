FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 8888

CMD ["sh", "-c", "[ -n \"$ELEVENLABS_API_KEY\" ] && echo \"ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY\" > .dev.vars; npx vite preview --port 8888 --host 0.0.0.0"]

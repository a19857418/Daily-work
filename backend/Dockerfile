FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY sql ./sql
COPY scripts ./scripts
COPY public ./public

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]

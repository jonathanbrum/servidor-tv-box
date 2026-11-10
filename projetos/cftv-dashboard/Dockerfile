# ==============================================================================
# Multi-Stage Build Otimizado para Mini-VPS TV Box (ARM64 / Alpine Linux)
# ==============================================================================

# Estágio 1: Compilação do Frontend Vite + React + Tailwind v4
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Estágio 2: Container Final de Execução Ultra-Leve
FROM node:20-alpine
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Instala apenas dependências essenciais de produção para poupar RAM e disco
COPY package*.json ./
RUN npm install --omit=dev

# Copia backend e assets estáticos
COPY . .
COPY --from=builder /app/dist ./dist

EXPOSE 3333

ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg
ENV PORT=3333

CMD ["npm", "start"]

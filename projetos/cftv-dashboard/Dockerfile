# Container Otimizado para Mini-VPS TV Box (ARM64 / Alpine Linux)
FROM node:20-alpine

# Instala FFmpeg nativo do Alpine (extremamente leve e compilado para ARM64)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Instala apenas dependências de produção para economizar RAM e disco
COPY package*.json ./
RUN npm install --omit=dev

# Copia código-fonte da aplicação
COPY . .

# Expõe porta padrão da central web
EXPOSE 3333

# Variáveis padrão
ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg
ENV PORT=3333

CMD ["npm", "start"]

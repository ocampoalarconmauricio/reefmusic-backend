# ReefMusic Backend - Dockerfile para Render.com
# Esto instala yt-dlp, ffmpeg y Node.js para procesar canciones

FROM node:18-slim

# ────────────────────────────────────────────────────────────────────────
# Instalar dependencias del sistema (yt-dlp, ffmpeg, python, etc)
# ────────────────────────────────────────────────────────────────────────

RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  ffmpeg \
  curl \
  && pip install --no-cache-dir --break-system-packages yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ────────────────────────────────────────────────────────────────────────
# Configurar directorio de trabajo
# ────────────────────────────────────────────────────────────────────────

WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de Node
RUN npm install --production

# Copiar código del servidor
COPY render-backend-server.js .

# ────────────────────────────────────────────────────────────────────────
# Exponer puerto y comando de inicio
# ────────────────────────────────────────────────────────────────────────

EXPOSE 3000

CMD ["npm", "start"]
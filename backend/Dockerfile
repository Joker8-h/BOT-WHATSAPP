FROM node:20-slim

# Instalar Chromium para whatsapp-web.js (puppeteer)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 1. Instalar dependencias del backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# 2. Generar cliente Prisma
COPY backend/prisma ./prisma/
RUN npx prisma generate

# 3. Copiar código fuente del backend
COPY backend/ .

# 4. Copiar build del frontend (para que el backend lo sirva)
# Asegúrate de haber ejecutado 'npm run build' en la carpeta frontend localmente
COPY frontend/dist ./frontend/dist

# Puerto del backend
EXPOSE 5000

# Directorios persistentes
RUN mkdir -p /app/.wwebjs_auth /app/logs /app/data

CMD ["node", "server.js"]

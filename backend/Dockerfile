# ─── ETAPA 1: Construcción del Frontend ───
FROM node:20-bookworm AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ─── ETAPA 2: Backend y Ejecución ───
# whatsapp-web.js usa Puppeteer + Chromium para WhatsApp Web
FROM node:20-bookworm
WORKDIR /app

# Instalar Chromium y dependencias para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    libcups2 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    ca-certificates \
    fonts-liberation \
    fonts-open-sans \
    fonts-freefont-ttf \
    git \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Variables de entorno para Puppeteer (usar Chromium del sistema)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium

# Instalar dependencias del backend (incluye whatsapp-web.js + puppeteer)
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copiar archivos de Prisma y generar cliente
COPY backend/prisma ./prisma/
RUN npx prisma generate

# Copiar el código del backend
COPY backend/ .

# COPIAR EL FRONTEND YA CONSTRUIDO desde la Etapa 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Asegurar permisos y directorios de sesión
RUN mkdir -p /app/.wwebjs_auth /app/logs /app/data && \
    chmod +x ./scripts/docker-start.sh

EXPOSE 5000
CMD ["./scripts/docker-start.sh"]

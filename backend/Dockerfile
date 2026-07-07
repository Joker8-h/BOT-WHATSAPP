# ─── ETAPA 1: Construcción del Frontend ───
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ─── ETAPA 2: Configuración del Backend y Ejecución ───
FROM node:20-slim
WORKDIR /app

# Instalar Chromium y dependencias para WhatsApp
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
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
    libxss1 \
    libxtst6 \
    libatspi2.0-0 \
    xdg-utils \
    dbus-x11 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/* && \
    dbus-uuidgen --ensure

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null

# Instalar dependencias del backend
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copiar archivos de Prisma y generar cliente
COPY backend/prisma ./prisma/
RUN npx prisma generate

# Copiar el código del backend
COPY backend/ .

# COPIAR EL FRONTEND YA CONSTRUIDO desde la Etapa 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Asegurar permisos y directorios
RUN mkdir -p /app/.wwebjs_auth /app/logs /app/data && \
    chmod +x ./scripts/docker-start.sh

EXPOSE 5000
CMD ["./scripts/docker-start.sh"]

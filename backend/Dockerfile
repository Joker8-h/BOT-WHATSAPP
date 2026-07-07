# ─── ETAPA 1: Construcción del Frontend ───
FROM node:20-bookworm AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ─── ETAPA 2: Backend y Ejecución ───
FROM node:20-bookworm
WORKDIR /app

# Instalar Chromium y TODAS sus dependencias de sistema
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

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

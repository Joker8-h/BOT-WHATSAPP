# ─── ETAPA 1: Construcción del Frontend ───
FROM node:20-bookworm AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ─── ETAPA 2: Backend y Ejecución ───
# Baileys usa WebSocket puro — NO necesita Chromium/Puppeteer
FROM node:20-bookworm-slim
WORKDIR /app

# Solo necesitamos dependencias mínimas para Node.js, crypto y git (requerido por Baileys en npm install)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    git \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Instalar dependencias del backend (incluye @whiskeysockets/baileys)
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
RUN mkdir -p /app/.baileys_auth /app/logs /app/data && \
    chmod +x ./scripts/docker-start.sh

EXPOSE 5000
CMD ["./scripts/docker-start.sh"]

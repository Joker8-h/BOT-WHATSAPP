#!/bin/sh

# 1. Esperar un poco a que el DB esté listo
echo "⏳ Esperando a que la base de datos se estabilice..."
sleep 5

# 2. Sincronizar el esquema de Prisma con la DB (sin borrar datos)
echo "🔄 Sincronizando esquema de base de datos..."
npx prisma db push --accept-data-loss

# 2b. Ejecutar semillas (Seed) para crear admin y sucursal base
echo "🌱 Ejecutando semillas (Seed)..."
node seed.js

# 2c. Poblar sedes y empleados
echo "🏪 Poblando sedes y empleados..."
node scripts/seedSedes.js

# 3. Limpiar sesiones antiguas de WhatsApp Web (ya no las usamos)
echo "🧹 Limpiando sesiones antiguas..."
rm -rf /app/.wwebjs_auth/*

# 4. Iniciar la aplicación
echo "🚀 Iniciando servidor (Baileys - Sin Chromium)..."
node --expose-gc server.js

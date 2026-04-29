#!/bin/sh

# 1. Esperar un poco a que el DB esté listo (opcional, pero ayuda)
echo "⏳ Esperando a que la base de datos se estabilice..."
sleep 5

# 2. Sincronizar el esquema de Prisma con la DB (sin borrar datos)
echo "🔄 Sincronizando esquema de base de datos..."
npx prisma db push --accept-data-loss

# 2b. Ejecutar semillas (Seed) para crear admin y sucursal base
echo "🌱 Ejecutando semillas (Seed)..."
node seed.js

# 3. Iniciar la aplicación
echo "🚀 Iniciando servidor..."
node server.js

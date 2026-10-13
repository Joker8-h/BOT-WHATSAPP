#!/bin/sh

# 1. Esperar un poco a que el DB esté listo
echo "⏳ Esperando a que la base de datos se estabilice..."
sleep 5

# 2. Liberar ids de Wompi repetidos antes del índice único
echo "🧹 Limpiando transacciones Wompi duplicadas..."
node scripts/dedupeWompiTx.js || echo "⚠️ No se pudieron limpiar duplicados de Wompi; el arranque sigue"

# 2b. Migrar el esquema de Prisma (fail-fast: nunca db push en prod, ocultaría drift)
echo "🔄 Migrando base de datos..."
npx prisma migrate deploy || { echo "❌ migrate deploy falló — revisa el drift antes de continuar"; exit 1; }

# 2b. Ejecutar semillas (Seed) para crear admin y sucursal base
echo "🌱 Ejecutando semillas (Seed)..."
node seed.js

# 2c. Poblar sedes y empleados
echo "🏪 Poblando sedes y empleados..."
node scripts/seedSedes.js

# 2d. Aplicar parche multimedia whatsapp-web.js
echo "🛡️ Aplicando parche multimedia whatsapp-web.js..."
node scripts/patchWwebjs.js || echo "⚠️ Advertencia al aplicar parche whatsapp-web.js"

# 3. Iniciar la aplicación
echo "🚀 Iniciando servidor (whatsapp-web.js + Chromium)..."
node --expose-gc server.js

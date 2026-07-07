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

# 2c. Poblar sedes y empleados
echo "🏪 Poblando sedes y empleados..."
node scripts/seedSedes.js

# 3. Limpiar cualquier sesión corrupta que haga colapsar a Chromium
echo "🧹 Eliminando sesiones corruptas antiguas..."
rm -rf /app/.wwebjs_auth/*

# 4. DIAGNÓSTICO: Verificar que Chromium funciona
echo "🔍 === DIAGNÓSTICO CHROMIUM ==="
echo "🔍 Binario encontrado en:"
which chromium || echo "NO ENCONTRADO en PATH"
ls -la /usr/bin/chromium 2>/dev/null || echo "NO EXISTE /usr/bin/chromium"

echo "🔍 Versión de Chromium:"
/usr/bin/chromium --version 2>&1 || echo "ERROR: No se pudo ejecutar chromium --version"

echo "🔍 Test headless rápido:"
timeout 5 /usr/bin/chromium --headless --no-sandbox --disable-setuid-sandbox --disable-gpu --dump-dom about:blank 2>&1 | head -5 || echo "RESULTADO: exit code $?"
echo "🔍 === FIN DIAGNÓSTICO ==="

# 5. Iniciar la aplicación
echo "🚀 Iniciando servidor..."
node --expose-gc server.js


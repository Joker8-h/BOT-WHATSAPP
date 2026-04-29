const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * LIMPIEZA TOTAL DE BLOQUEOS
 */
function totalClean() {
    console.log('🌪️ [TOTAL-CLEAN] Iniciando limpieza absoluta...');
    
    // Rutas posibles
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    
    if (!fs.existsSync(authDir)) {
        console.log('ℹ️ No hay sesión para limpiar.');
        return;
    }

    try {
        // Borramos TODOS los archivos que empiecen por Singleton en cualquier subcarpeta
        // de forma recursiva y forzada
        execSync(`find ${authDir} -name "Singleton*" -exec rm -rf {} +`, { stdio: 'inherit' });
        console.log('✅ Archivos Singleton eliminados.');
        
        // También borramos los .lock que a veces deja Puppeteer
        execSync(`find ${authDir} -name "*.lock" -exec rm -rf {} +`, { stdio: 'inherit' });
        console.log('✅ Archivos .lock eliminados.');
        
    } catch (error) {
        console.warn('⚠️ Error en limpieza de comandos, intentando manual...');
        // Fallback manual muy agresivo
        const clearDir = (dir) => {
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const p = path.join(dir, file);
                const stat = fs.lstatSync(p);
                if (stat.isDirectory()) {
                    clearDir(p);
                } else if (file.includes('Singleton') || file.includes('.lock')) {
                    try { fs.unlinkSync(p); } catch (e) {}
                }
            });
        };
        try { clearDir(authDir); } catch (e) {}
    }
    console.log('✨ [TOTAL-CLEAN] Entorno listo.');
}

totalClean();

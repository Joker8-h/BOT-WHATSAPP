const fs = require('fs');
const path = require('path');

/**
 * Script simplificado para limpiar bloqueos de Chromium
 */
function clearLocks() {
    console.log('🧹 [CLEANUP] Limpiando archivos de bloqueo...');
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    
    if (!fs.existsSync(authDir)) return;

    const walk = (dir) => {
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.lstatSync(fullPath).isDirectory()) {
                    walk(fullPath);
                } else if (file.includes('SingletonLock') || file.includes('SingletonCookie') || file.includes('SingletonSocket')) {
                    try {
                        fs.unlinkSync(fullPath);
                        console.log(`✅ Eliminado: ${file}`);
                    } catch (e) {
                        // Ignorar si no se puede (está en uso real)
                    }
                }
            }
        } catch (e) {}
    };

    walk(authDir);
    console.log('✨ [CLEANUP] Proceso terminado.');
}

clearLocks();

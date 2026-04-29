const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Script para limpiar bloqueos de Chromium en Railway/Docker
 * Se ejecuta antes de iniciar el servidor.
 */
function clearLocks() {
    console.log('🧹 [CLEANUP] Iniciando limpieza de bloqueos de sesión...');
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    
    if (!fs.existsSync(authDir)) {
        console.log('ℹ️ No existe carpeta .wwebjs_auth, nada que limpiar.');
        return;
    }

    try {
        // Usamos comandos de sistema (Linux/Unix) para una limpieza profunda y agresiva
        // Borramos SingletonLock, SingletonCookie y SingletonSocket
        const findCommand = `find .wwebjs_auth -name "Singleton*" -delete`;
        execSync(findCommand, { stdio: 'inherit' });
        console.log('✅ [CLEANUP] Archivos Singleton* eliminados exitosamente.');
    } catch (error) {
        console.warn('⚠️ [CLEANUP] Error usando find, intentando método manual...', error.message);
        
        // Fallback manual si el comando find falla
        const deleteRecursive = (dir) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                if (fs.lstatSync(fullPath).isDirectory()) {
                    deleteRecursive(fullPath);
                } else if (file.startsWith('Singleton')) {
                    try {
                        fs.unlinkSync(fullPath);
                        console.log(`- Borrado: ${fullPath}`);
                    } catch (e) {}
                }
            }
        };
        try { deleteRecursive(authDir); } catch (e) {}
    }
}

clearLocks();

const fs = require('fs');
const path = require('path');

/**
 * Este script elimina los archivos SingletonLock que genera Chrome/Puppeteer.
 * En entornos como Railway, estos archivos pueden quedar bloqueados tras un reinicio
 * forzado, impidiendo que la nueva instancia de WhatsApp se inicie correctamente.
 */
async function fixLocks() {
    const authDir = path.join(process.cwd(), '.wwebjs_auth');
    
    if (!fs.existsSync(authDir)) {
        console.log('ℹ️ No existe directorio de autenticación, nada que limpiar.');
        return;
    }

    const sessions = fs.readdirSync(authDir);
    
    for (const session of sessions) {
        if (session.startsWith('session-')) {
            const sessionPath = path.join(authDir, session);
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log(`✅ Sesión completamente eliminada para forzar reinicio limpio: ${session}`);
            } catch (err) {
                console.error(`❌ No se pudo eliminar la sesión ${session}: ${err.message}`);
            }
        }
    }
}

fixLocks().then(() => console.log('🚀 Limpieza de candados completada.'));

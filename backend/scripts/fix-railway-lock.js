const fs = require('fs');
const path = require('path');

/**
 * Este script elimina los archivos SingletonLock que genera Chrome/Puppeteer.
 * En entornos como Railway, estos archivos pueden quedar bloqueados tras un reinicio
 * forzado, impidiendo que la nueva instancia de WhatsApp se inicie correctamente.
 */
const { removeChromiumLocks } = require('../src/utils/processCleanup');

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
                removeChromiumLocks(sessionPath);
                console.log(`✅ Candados de Chromium eliminados preservando la sesión: ${session}`);
            } catch (err) {
                console.error(`❌ Error al limpiar candados en ${session}: ${err.message}`);
            }
        }
    }
}

fixLocks().then(() => console.log('🚀 Limpieza de candados completada.'));

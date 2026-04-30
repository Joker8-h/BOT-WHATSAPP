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
            const lockPath = path.join(authDir, session, 'Default', 'SingletonLock');
            const rootLockPath = path.join(authDir, session, 'SingletonLock');
            
            [lockPath, rootLockPath].forEach(lp => {
                if (fs.existsSync(lp)) {
                    try {
                        fs.unlinkSync(lp);
                        console.log(`✅ Candado eliminado: ${lp}`);
                    } catch (err) {
                        console.error(`❌ No se pudo eliminar ${lp}: ${err.message}`);
                    }
                }
            });
        }
    }
}

fixLocks().then(() => console.log('🚀 Limpieza de candados completada.'));

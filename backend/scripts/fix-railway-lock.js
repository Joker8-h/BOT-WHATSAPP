const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * LIMPIEZA AGRESIVA DE NIVEL DE SISTEMA
 * Borra los candados de Chromium usando comandos de Linux directamente.
 */
function hardClean() {
    console.log('🛡️ [HARD-CLEAN] Iniciando limpieza profunda de candados...');
    const authPath = path.join(process.cwd(), '.wwebjs_auth');

    if (!fs.existsSync(authPath)) {
        console.log('ℹ️ No hay carpeta de sesión. Nada que limpiar.');
        return;
    }

    try {
        // Comando de Linux para borrar recursivamente todos los archivos de bloqueo
        // SingletonLock, SingletonSocket, SingletonCookie y archivos .lock
        const command = `find ${authPath} -name "Singleton*" -exec rm -f {} + && find ${authPath} -name "*.lock" -exec rm -f {} +`;
        
        console.log(`🚀 Ejecutando: ${command}`);
        execSync(command, { stdio: 'inherit' });
        
        console.log('✅ [HARD-CLEAN] ¡Candados eliminados por la fuerza!');
    } catch (error) {
        console.error('❌ [HARD-CLEAN] Error en limpieza profunda:', error.message);
        
        // Intento manual desesperado si lo anterior falla
        try {
            execSync(`rm -rf .wwebjs_auth/**/Default/Singleton*`, { stdio: 'inherit' });
        } catch (e) {}
    }
}

hardClean();

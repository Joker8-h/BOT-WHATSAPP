/**
 * UTILS: processCleanup.js
 * Propósito: Matar procesos de Chrome huérfanos y limpiar perfiles temporales.
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

function cleanupPuppeteer() {
  logger.info('🧹 Limpiando procesos y perfiles temporales de Chromium...');

  // 1. En Windows: matar procesos Chrome huérfanos
  if (process.platform === 'win32') {
    exec('taskkill /F /IM chrome.exe /T', (err) => {
      if (err) {
        if (err.message.includes('not found')) {
          logger.info('✅ No se encontraron procesos Chrome abiertos.');
        } else {
          logger.warn('⚠️ Algunos procesos Chrome no se pudieron cerrar.');
        }
        return;
      }
      logger.info('✨ Procesos Chrome eliminados.');
    });
  }

  // 2. Limpiar perfiles temporales de Chromium que hayan quedado huérfanos
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (entry.startsWith('chromium_branch_') || entry.startsWith('puppeteer_dev_chrome_profile-')) {
        const fullPath = path.join(tmpDir, entry);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          logger.info(`🗑️ Perfil Chromium temporal eliminado: ${entry}`);
        } catch (e) {
          logger.warn(`⚠️ No se pudo eliminar ${entry}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    logger.warn(`⚠️ Error limpiando perfiles temporales: ${e.message}`);
  }
}

module.exports = { cleanupPuppeteer };

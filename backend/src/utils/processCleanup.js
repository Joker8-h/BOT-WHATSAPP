/**
 * UTILS: processCleanup.js
 * Propósito: Matar procesos de Chrome huérfanos que a veces deja Puppeteer en Windows.
 * Útil para mantenimiento preventivo antes de iniciar el servidor en producción.
 */
const { exec } = require('child_process');
const logger = require('./src/utils/logger');

function cleanupPuppeteer() {
  if (process.platform !== 'win32') return;

  logger.info('🧹 Iniciando limpieza de procesos Chrome/Puppeteer...');
  
  // Comando para matar procesos de chrome que no tienen una ventana visible (huérfanos)
  // ⚠️ Precaución: Esto cerrará CUALQUIER instancia de Chrome si se ejecuta sin cuidado.
  // Pero en un servidor dedicado a este bot, es lo ideal.
  exec('taskkill /F /IM chrome.exe /T', (err, stdout, stderr) => {
    if (err) {
      if (err.message.includes('not found')) {
        logger.info('✅ No se encontraron procesos de Chrome abiertos.');
      } else {
        logger.warn('⚠️ Nota: Algunos procesos no pudieron ser cerrados o no existían.');
      }
      return;
    }
    logger.info('✨ Procesos de Chrome limpiados con éxito.');
  });
}

module.exports = { cleanupPuppeteer };

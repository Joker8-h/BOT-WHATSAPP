const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

function cleanupPuppeteer() {
  logger.info('🧹 Limpiando procesos y perfiles Chromium huérfanos...');

  // 1. Matar procesos Chromium zombie
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -x "chromium" 2>/dev/null; pkill -x "chromium-browser" 2>/dev/null; pkill -f "chrome.*--headless" 2>/dev/null', { stdio: 'ignore' });
    }
  } catch (_) {}

  // 2. Eliminar perfiles temporales que Puppeteer haya dejado huérfanos
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    let cleaned = 0;
    for (const entry of entries) {
      if (entry.startsWith('puppeteer_dev_chrome_profile-') || entry.startsWith('.com.google.Chrome')) {
        const fullPath = path.join(tmpDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            cleaned++;
          }
        } catch (_) {}
      }
    }
    if (cleaned > 0) logger.info(`🗑️ ${cleaned} perfil(es) temporal(es) de Chromium eliminados.`);
  } catch (_) {}

  // 3. Limpiar SingletonLock de .wwebjs_auth (LocalAuth asigna userDataDir aquí)
  const wwebjsDir = path.join(process.cwd(), '.wwebjs_auth');
  try {
    if (fs.existsSync(wwebjsDir)) {
      const branches = fs.readdirSync(wwebjsDir);
      for (const branch of branches) {
        const branchDir = path.join(wwebjsDir, branch);
        if (fs.statSync(branchDir).isDirectory()) {
          const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
          for (const lock of locks) {
            const lockPath = path.join(branchDir, lock);
            try {
              if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
            } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}

  // 4. Limpiar posibles SingletonLock/SingletonSocket en el HOME
  const chromeConfigDir = path.join(os.homedir(), '.config', 'chromium');
  try {
    if (fs.existsSync(chromeConfigDir)) {
      const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const lock of locks) {
        const lockPath = path.join(chromeConfigDir, lock);
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      }
    }
  } catch (_) {}

  logger.info('✅ Limpieza de Chromium completada.');
}

module.exports = { cleanupPuppeteer };

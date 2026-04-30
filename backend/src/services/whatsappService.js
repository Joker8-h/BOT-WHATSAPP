// ─────────────────────────────────────────────────────────
//  SERVICE: WhatsApp — Gestión Multi-sucursal (Multi-Session)
// ─────────────────────────────────────────────────────────
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const { antiBanDelay } = require('../utils/helpers');
const { prisma } = require('../config/database');
const path = require('path');
const fs = require('fs');

class WhatsAppService {
  constructor() {
    // Mapa de clientes: branchId -> client
    this.clients = new Map();
    // Mapa de estados: branchId -> { isReady: boolean, qr: string, status: string }
    this.sessions = new Map();
    this.pendingInits = new Set(); // 🚩 Nuevo: Control de procesos en curso
    
    this.messageHandler = null;

    // Flag para distinguir desconexiones manuales vs accidentales
    this.manualLogout = new Set();

    // Configuración global anti-ban
    this.maxPerMinute = parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20;

    // El cierre de recursos se maneja asincrónicamente en server.js (Graceful Shutdown)
  }

  /**
   * Getter para verificar si la sucursal maestra (1) está lista
   */
  get isReady() {
    return this.sessions.get(1)?.isReady || false;
  }

  /**
   * Inicializa todas las sucursales autorizadas al arrancar el servidor
   */
  async initAllActiveSessions() {
    try {
      logger.info('🔍 Buscando sucursales autorizadas para autostart...');
      const authorizedBranches = await prisma.branch.findMany({
        where: { isAuthorized: true, isActive: true }
      });

      if (authorizedBranches.length === 0) {
        logger.info('ℹ️ No hay sucursales autorizadas para iniciar automáticamente.');
        return;
      }

      logger.info(`✨ Iniciando sesión maestra (Sucursal 1)...`);
      await this.initializeBranch(1);
    } catch (error) {
      logger.error('❌ Error en el proceso de autostart:', error);
    }
  }

  /**
   * Inicializa o recupera una sesión para una sucursal específica
   */
  async initializeBranch(branchId) {
    // ── Evitar duplicidad de inicialización (CRÍTICO) ──
    if (this.clients.has(branchId)) {
      logger.info(`ℹ️ Sucursal ${branchId} ya tiene un cliente activo.`);
      return this.clients.get(branchId);
    }

    if (this.pendingInits.has(branchId)) {
      logger.info(`⏳ Sucursal ${branchId} ya se está inicializando. Ignorando petición duplicada.`);
      return null;
    }

    this.pendingInits.add(branchId);

    logger.info(`🚀 [WA-INIT] Iniciando instancia para sucursal: ${branchId}`);
    
    // Limpieza de candados de sesión (Locks) — Crítico para Railway/Docker
    const possibleLockPaths = [
      path.join(process.cwd(), '.wwebjs_auth', `session-branch_${branchId}`, 'Default', 'SingletonLock'),
      path.join(process.cwd(), '.wwebjs_auth', `session-branch_${branchId}`, 'SingletonLock')
    ];

    // Intentar borrar el candado con reintentos (Railway/Docker fix)
    let lockCleared = false;
    for (let i = 0; i < 15; i++) {
      for (const lockPath of possibleLockPaths) {
        try {
          if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
            logger.info(`🔓 Candado eliminado con éxito en intento ${i+1}: ${lockPath}`);
            lockCleared = true;
          } else {
            lockCleared = true; // No existe, así que estamos bien
          }
        } catch (e) {
          logger.warn(`⏳ Intento ${i+1}: El candado de la sucursal ${branchId} sigue retenido. Esperando 1s...`);
        }
      }
      if (lockCleared) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const startTime = Date.now();

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `branch_${branchId}`,
        dataPath: './.wwebjs_auth',
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-features=IsolateOrigins,site-per-process',
          '--ignore-certificate-errors',
          '--window-size=1280,800',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
          '--disable-component-update',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-default-apps',
          '--mute-audio',
          '--no-default-browser-check',
          '--disable-client-side-phishing-detection',
          '--disable-popup-blocking',
          '--password-store=basic',
          '--use-mock-keychain',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        protocolTimeout: 300000,
      },
      authTimeoutMs: 300000, // 5 minutos de margen para sincronizar
      takeoverOnConflict: true,
      takeoverTimeoutMs: 15000,
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1012170943-alpha.html',
      }
    });

    // Estado inicial
    this.sessions.set(branchId, { isReady: false, qr: null, status: 'INITIALIZING' });

    // ── Eventos del Cliente ──
    client.on('qr', (qr) => {
      logger.info(`📱 QR Generado para sucursal ${branchId}`);
      this.sessions.set(branchId, { ...this.sessions.get(branchId), qr, status: 'WAITING_QR' });
    });

    client.on('ready', () => {
      logger.info(`✅ WhatsApp sucursal ${branchId} conectado!`);
      this.sessions.set(branchId, { isReady: true, qr: null, status: 'READY' });
    });

    client.on('authenticated', () => {
      logger.info(`🔐 WhatsApp sucursal ${branchId} autenticado`);
      // Fallback: si 'ready' no llega (script injection timeout), marcar como listo igual
      setTimeout(() => {
        const s = this.sessions.get(branchId);
        if (s && !s.isReady) {
          logger.info(`✅ WhatsApp sucursal ${branchId} listo (vía fallback authenticated)`);
          this.sessions.set(branchId, { ...s, isReady: true, status: 'READY' });
        }
      }, 8000); // Esperar 8s por si llega el 'ready' real
    });

    client.on('auth_failure', (msg) => {
      logger.error(`❌ Error auth sucursal ${branchId}:`, msg);
      this.sessions.set(branchId, { ...this.sessions.get(branchId), status: 'AUTH_FAILURE' });
    });

    client.on('disconnected', (reason) => {
      logger.warn(`🔌 WhatsApp sucursal ${branchId} desconectado:`, reason);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
      this.clients.delete(branchId);

      // Solo auto-reconectar si NO fue un cierre manual desde el admin
      if (this.manualLogout.has(branchId)) {
        logger.info(`🛑 Desconexión MANUAL de sucursal ${branchId}. No se reconectará.`);
        this.manualLogout.delete(branchId);
      } else {
        logger.info(`🔄 Desconexión accidental. Regenerando QR para sucursal ${branchId} en 5s...`);
        setTimeout(() => {
          this.initializeBranch(branchId).catch(err => 
            logger.error(`Error re-inicializando tras desconexión en ${branchId}:`, err)
          );
        }, 5000);
      }
    });

    // Handler de mensajes entrantes
    client.on('message', async (msg) => {
      logger.info(`📩 [WA-RAW] Mensaje de ${msg.from}: ${msg.body?.substring(0, 20)}...`);
      if (this.messageHandler) {
        try {
          await this.messageHandler(msg, branchId);
        } catch (error) {
          logger.error(`Error procesando mensaje en sucursal ${branchId}:`, error);
        }
      }
    });

    // ── Iniciar Cliente (Sin await para evitar timeout 500) ──
    this.clients.set(branchId, client);
    
    client.initialize().then(() => {
      const endTime = Date.now();
      logger.info(`✅ [WA-READY] WhatsApp sucursal ${branchId} listo en ${(endTime - startTime)/1000}s`);
      this.pendingInits.delete(branchId);
    }).catch(err => {
      logger.error(`❌ Error crítico iniciando sucursal ${branchId}:`, err);
      this.sessions.set(branchId, { ...this.sessions.get(branchId), status: 'ERROR' });
      this.clients.delete(branchId);
      this.pendingInits.delete(branchId);
      // Auto-recovery: reintentar en 10 segundos
      logger.info(`🔄 Auto-recovery: reintentando sucursal ${branchId} en 10s...`);
      setTimeout(() => {
        this.initializeBranch(branchId).catch(e => 
          logger.error(`❌ Auto-recovery falló para sucursal ${branchId}:`, e)
        );
      }, 10000);
    });

    return client;
  }

  /**
   * Registra el handler global de mensajes
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }

  /**
   * Envía un mensaje desde una sucursal específica
   */
  async sendMessage(branchId, to, text) {
    const masterBranchId = 1;
    const client = this.clients.get(masterBranchId);
    const session = this.sessions.get(masterBranchId);

    if (!client) {
      logger.warn(`WhatsApp Central (Branch ${masterBranchId}): cliente no existe`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ WhatsApp sucursal ${masterBranchId} aún no está listo (isReady=false). Intentando enviar de todas formas...`);
    }

    try {
      await antiBanDelay();
      
      // Sanitizar el destinatario
      let chatId = to;
      if (!to.includes('@')) {
        const cleanPhone = to.replace(/\D/g, ''); 
        chatId = `${cleanPhone}@c.us`;
      }
      // Los @lid se usan tal cual — no intentar obtener chat object para evitar timeouts

      // --- Delay natural (simula tipeo sin bloquear Puppeteer) ---
      const typingDelay = Math.min(text.length * 20, 2000);
      await new Promise(resolve => setTimeout(resolve, typingDelay));

      // --- Lógica de División de Mensajes Largos ---
      const maxLength = 450;
      if (text.length > maxLength) {
        const parts = [];
        let remaining = text;
        while (remaining.length > maxLength) {
          let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
          if (splitIndex === -1) splitIndex = remaining.lastIndexOf('\n', maxLength);
          if (splitIndex === -1) splitIndex = remaining.lastIndexOf('. ', maxLength);
          if (splitIndex === -1) splitIndex = maxLength;
          parts.push(remaining.substring(0, splitIndex).trim());
          remaining = remaining.substring(splitIndex).trim();
        }
        if (remaining) parts.push(remaining);

        for (const part of parts) {
          await client.sendMessage(chatId, part);
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
        return true;
      }

      // --- Envío Normal ---
      await client.sendMessage(chatId, text);
      logger.debug(`📤 Mensaje enviado desde sucursal ${branchId} a ${chatId}`);
      return true;
    } catch (error) {
      logger.error(`❌ Error enviando mensaje desde sucursal ${branchId} a ${to}:`, error);
      return false;
    }
  }

  /**
   * Envía una imagen/media desde una sucursal específica
   * @param {string} branchId - ID de la sucursal
   * @param {string} to - Destinatario
   * @param {string} mediaSource - URL o Path local
   * @param {object} options - { caption, isAudio }
   */
  async sendMedia(branchId, to, mediaSource, options = {}) {
    const masterBranchId = 1;
    const client = this.clients.get(masterBranchId);
    const session = this.sessions.get(masterBranchId);

    if (!client) {
      logger.warn(`WhatsApp Central (Branch ${masterBranchId}): cliente no existe para enviar media`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ WhatsApp sucursal ${masterBranchId} aún no está listo para media (isReady=false). Intentando enviar...`);
    }

    try {
      await antiBanDelay();
      
      let chatId = to;
      if (!to.includes('@')) {
        const cleanPhone = to.replace(/\D/g, '');
        chatId = `${cleanPhone}@c.us`;
      }

      logger.info(`🖼️ Preparando envío de media para ${chatId} desde branch ${branchId}`);
      
      let media;
      if (mediaSource.startsWith('http')) {
        media = await MessageMedia.fromUrl(mediaSource);
      } else {
        // Asumimos que es un path local (como el generado por TTS)
        media = MessageMedia.fromFilePath(mediaSource);
      }

      const sendOptions = {};
      if (options.caption) sendOptions.caption = options.caption;
      if (options.isAudio) {
        sendOptions.sendAudioAsVoice = true; // Esto lo envía como nota de voz azul
      }

      await client.sendMessage(chatId, media, sendOptions);
      
      logger.info(`📤 Media enviado exitosamente a ${chatId}`);
      return true;
    } catch (error) {
      logger.error(`❌ Error enviando media (Source: ${mediaSource}) en sucursal ${branchId} a ${to}:`, error.message);
      return false;
    }
  }

  /**
   * Obtiene el estado y QR actual de todas las sucursales (para Admin)
   */
  getAllStatuses() {
    return Object.fromEntries(this.sessions);
  }

  /**
   * Obtiene el estado de una sucursal específica
   */
  getBranchStatus(branchId) {
    return this.sessions.get(branchId) || { isReady: false, qr: null, status: 'NOT_FOUND' };
  }

  /**
   * Envía un mensaje a un grupo específico de la sucursal (por ejemplo, para despacho)
   */
  async notifyGroup(branchId, message) {
    const masterBranchId = 1;
    const client = this.clients.get(masterBranchId);
    if (!client) return false;

    try {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { notificationGroupName: true }
      });

      if (!branch || !branch.notificationGroupName) {
        logger.warn(`Sucursal ${branchId} no tiene grupo de notificación configurado`);
        return false;
      }

      const chats = await client.getChats();
      const group = chats.find(c => c.isGroup && c.name === branch.notificationGroupName);

      if (group) {
        await client.sendMessage(group.id._serialized, message);
        logger.info(`📢 Notificación enviada al grupo "${branch.notificationGroupName}" para sucursal ${branchId}`);
        return true;
      } else {
        logger.warn(`Grupo "${branch.notificationGroupName}" no encontrado en WhatsApp para sucursal ${branchId}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error notificando al grupo para sucursal ${branchId}:`, error);
      return false;
    }
  }

  /**
   * Envía múltiples mensajes (Campaña) con control de delay
   * @param {number} branchId - ID de la sucursal emisora
   * @param {Array} contacts - Lista de objetos Contact
   * @param {string} message - Texto del mensaje
   * @param {number} delayMs - Retraso entre envíos (default 8000ms)
   */
  async sendBulkMessages(branchId, contacts, message, delayMs = 8000) {
    const results = [];
    logger.info(`🚀 Iniciando envío masivo para sucursal ${branchId} (${contacts.length} contactos)`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const chatId = `${contact.phone}@c.us`;

      try {
        // Delay incremental para evitar detección de ráfagas
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, delayMs + jitter));

        const sent = await this.sendMessage(1, chatId, message); // Siempre por el 1
        results.push({ phone: contact.phone, sent });

        if ((i + 1) % 5 === 0) {
          logger.info(`📊 Progreso campaña sucursal ${branchId}: ${i + 1}/${contacts.length}`);
        }
      } catch (error) {
        logger.error(`❌ Error enviando masivo a ${contact.phone}:`, error);
        results.push({ phone: contact.phone, sent: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Cierra la sesión de una sucursal
   */
  async destroyBranch(branchId) {
    const client = this.clients.get(branchId);
    if (client) {
      logger.info(`🗑️ Destruyendo instancia de WhatsApp para sucursal ${branchId}...`);
      
      // Marcar como cierre MANUAL para que el evento 'disconnected' NO reconecte
      this.manualLogout.add(branchId);

      try {
        // Intentar logout con un timeout para que no se quede colgado si la sesión está rota
        const logoutPromise = client.logout();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout en logout')), 10000)
        );

        await Promise.race([logoutPromise, timeoutPromise]);
        logger.info(`✅ Logout exitoso para sucursal ${branchId}`);
      } catch (e) {
        logger.warn(`⚠️ No se pudo hacer logout limpio (o timeout) de sucursal ${branchId}:`, e.message);
      }

      try {
        await client.destroy();
        logger.info(`💨 Cliente de sucursal ${branchId} destruido correctamente.`);
      } catch (e) {
        logger.error(`❌ Error destruyendo cliente de sucursal ${branchId}:`, e.message);
      }

      this.clients.delete(branchId);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
      return true;
    }
    
    // Si no hay cliente en memoria, pero el usuario quiere "limpiar", aseguramos el estado
    this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
    return false;
  }

  /**
   * Cierra todas las sesiones activas (Limpieza total)
   */
  async destroyAll() {
    logger.info('🛑 Cerrando todas las instancias de WhatsApp...');
    for (const [branchId, client] of this.clients.entries()) {
      try {
        await client.destroy();
        logger.info(`💨 Cliente sucursal ${branchId} destruido`);
      } catch (e) {
        // Ignorar errores en el cierre masivo
      }
    }
    this.clients.clear();
    this.sessions.clear();
  }
}

module.exports = new WhatsAppService();

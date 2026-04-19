// ─────────────────────────────────────────────────────────
//  SERVICE: WhatsApp — Gestión Multi-sucursal (Multi-Session)
// ─────────────────────────────────────────────────────────
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const { antiBanDelay } = require('../utils/helpers');
const { prisma } = require('../config/database');

class WhatsAppService {
  constructor() {
    // Mapa de clientes: branchId -> client
    this.clients = new Map();
    // Mapa de estados: branchId -> { isReady: boolean, qr: string, status: string }
    this.sessions = new Map();
    
    this.messageHandler = null;

    // Configuración global anti-ban
    this.maxPerMinute = parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20;

    // El cierre de recursos se maneja asincrónicamente en server.js (Graceful Shutdown)
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

      logger.info(`✨ Iniciando secuencialmente ${authorizedBranches.length} sucursales...`);

      for (const branch of authorizedBranches) {
        try {
          // Iniciamos una por una con un delay de 10 segundos entre ellas para no saturar la RAM
          await this.initializeBranch(branch.id);
          await new Promise(resolve => setTimeout(resolve, 10000));
        } catch (error) {
          logger.error(`❌ Falló autostart para sucursal ${branch.id}:`, error.message);
        }
      }
    } catch (error) {
      logger.error('❌ Error en el proceso de autostart:', error);
    }
  }

  /**
   * Inicializa o recupera una sesión para una sucursal específica
   */
  async initializeBranch(branchId) {
    if (this.clients.has(branchId)) {
      logger.info(`Reutilizando sesión existente para sucursal: ${branchId}`);
      return this.clients.get(branchId);
    }

    logger.info(`🚀 [WA-INIT] Iniciando instancia para sucursal: ${branchId}`);
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
          '--disable-features=IsolateOrigins,site-per-process', // Mejora velocidad
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        // User Agent moderno para evitar detección de "Navegador no compatible" en cuentas personales
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
      webVersionCache: {
        type: 'remote',
        // Fuente confiable y actualizada para versiones de WhatsApp Web
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
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
    });

    client.on('auth_failure', (msg) => {
      logger.error(`❌ Error auth sucursal ${branchId}:`, msg);
      this.sessions.set(branchId, { ...this.sessions.get(branchId), status: 'AUTH_FAILURE' });
    });

    client.on('disconnected', (reason) => {
      logger.warn(`🔌 WhatsApp sucursal ${branchId} desconectado:`, reason);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
      this.clients.delete(branchId);

      // Si la desconexión no fue manual, intentamos re-inicializar
      // esto generará un nuevo QR automáticamente si la sesión se perdió
      logger.info(`🔄 Intentando regenerar QR para sucursal ${branchId} tras desconexión en 5s...`);
      setTimeout(() => {
        this.initializeBranch(branchId).catch(err => 
          logger.error(`Error re-inicializando tras desconexión en ${branchId}:`, err)
        );
      }, 5000);
    });

    // Handler de mensajes entrantes
    client.on('message', async (msg) => {
      if (msg.from === 'status@broadcast') return;
      if (msg.fromMe) return;
      if (msg.isGroupMsg) return;

      if (this.messageHandler) {
        try {
          // Inyectamos el branchId en el mensaje para que el handler sepa de dónde viene
          msg.branchId = branchId;
          await this.messageHandler(msg);
        } catch (error) {
          logger.error(`Error procesando mensaje en sucursal ${branchId}:`, error);
        }
      }
    });

    try {
      this.clients.set(branchId, client);
      await client.initialize();
      const endTime = Date.now();
      logger.info(`✅ [WA-READY] WhatsApp sucursal ${branchId} listo en ${(endTime - startTime)/1000}s`);
      return client;
    } catch (err) {
      logger.error(`Error crítico iniciando sucursal ${branchId}:`, err);
      this.clients.delete(branchId);
      throw err;
    }
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
    const client = this.clients.get(branchId);
    const session = this.sessions.get(branchId);

    if (!client || !session?.isReady) {
      logger.warn(`WhatsApp sucursal ${branchId} no está listo para enviar`);
      return false;
    }

    try {
      await antiBanDelay();
      
      // Sanitizar el destinatario por si viene con basura o formato lid
      let chatId = to;
      if (!to.includes('@')) {
        const cleanPhone = to.replace(/\D/g, ''); // Solo números
        chatId = `${cleanPhone}@c.us`;
      }

      const chat = await client.getChatById(chatId);
      await chat.sendStateTyping();
      
      const typingDelay = Math.min(text.length * 30, 3000);
      await new Promise(resolve => setTimeout(resolve, typingDelay));

      await client.sendMessage(chatId, text);
      logger.debug(`📤 Mensaje enviado desde sucursal ${branchId} a ${chatId}`);
      return true;
    } catch (error) {
      logger.error(`❌ Error enviando mensaje desde sucursal ${branchId} a ${to}:`, error.message);
      return false;
    }
  }

  /**
   * Envía una imagen/media desde una sucursal específica
   * @param {string} branchId - ID de la sucursal
   * @param {string} to - Destinatario
   * @param {string} url - URL de la imagen
   * @param {string} caption - Texto opcional
   */
  async sendMedia(branchId, to, url, caption = '') {
    const client = this.clients.get(branchId);
    const session = this.sessions.get(branchId);

    if (!client || !session?.isReady) {
      logger.warn(`WhatsApp sucursal ${branchId} no está listo para enviar media`);
      return false;
    }

    try {
      await antiBanDelay();
      
      let chatId = to;
      if (!to.includes('@')) {
        const cleanPhone = to.replace(/\D/g, '');
        chatId = `${cleanPhone}@c.us`;
      }

      logger.info(`🖼️ Preparando envío de media para ${chatId} desde branch ${branchId}`);
      
      const media = await MessageMedia.fromUrl(url);
      await client.sendMessage(chatId, media, { caption });
      
      logger.info(`📤 Media enviado exitosamente a ${chatId}`);
      return true;
    } catch (error) {
      logger.error(`❌ Error enviando media (URL: ${url}) en sucursal ${branchId} a ${to}:`, error.message);
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
    const client = this.clients.get(branchId);
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

        const sent = await this.sendMessage(branchId, chatId, message);
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
      await client.destroy();
      this.clients.delete(branchId);
      this.sessions.delete(branchId);
      return true;
    }
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

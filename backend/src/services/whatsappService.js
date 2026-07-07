// ─────────────────────────────────────────────────────────
//  SERVICE: WhatsApp — Gestión Multi-sucursal con Baileys
//  Sin Chromium/Puppeteer — WebSocket directo a WhatsApp
// ─────────────────────────────────────────────────────────
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
  proto,
  downloadContentFromMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  getContentType,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const logger = require('../utils/logger');
const { antiBanDelay } = require('../utils/helpers');
const { prisma } = require('../config/database');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const qrcode = require('qrcode');
const P = require('pino');

// Logger silencioso para Baileys (no llena los logs)
const baileysLogger = P({ level: 'silent' });

class WhatsAppService {
  constructor() {
    // Mapa de sockets: branchId -> socket Baileys
    this.clients = new Map();
    // Mapa de estados: branchId -> { isReady, qr, status }
    this.sessions = new Map();
    this.pendingInits = new Set();
    
    this.messageHandler = null;
    this.manualLogout = new Set();
    this.maxPerMinute = parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20;

    // Directorio para guardar sesiones (auth)
    this.authDir = path.join(process.cwd(), '.baileys_auth');
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
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
    if (this.clients.has(branchId)) {
      logger.info(`ℹ️ Sucursal ${branchId} ya tiene un cliente activo.`);
      return this.clients.get(branchId);
    }

    if (this.pendingInits.has(branchId)) {
      logger.info(`⏳ Sucursal ${branchId} ya se está inicializando. Ignorando petición duplicada.`);
      return null;
    }

    this.pendingInits.add(branchId);
    logger.info(`🚀 [WA-INIT] Iniciando instancia Baileys para sucursal: ${branchId}`);

    try {
      const authDir = path.join(this.authDir, `branch_${branchId}`);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();
      
      logger.info(`📦 Baileys versión WA: ${version.join('.')}`);

      // Estado inicial
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'INITIALIZING' });

      const sock = makeWASocket({
        version,
        logger: baileysLogger,
        auth: state,
        printQRInTerminal: false, // Lo manejamos nosotros
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 250,
        browser: ['Fantasias Bot', 'Chrome', '120.0.0'],
      });

      this.clients.set(branchId, sock);

      // ── Evento: QR Code ──
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logger.info(`📱 QR Generado para sucursal ${branchId}`);
          // Convertir QR a base64 image para el admin panel
          try {
            const qrBase64 = await qrcode.toDataURL(qr);
            this.sessions.set(branchId, { 
              ...this.sessions.get(branchId), 
              qr: qrBase64, 
              status: 'WAITING_QR' 
            });
          } catch (e) {
            // Si no puede generar imagen, guardar el string raw
            this.sessions.set(branchId, { 
              ...this.sessions.get(branchId), 
              qr, 
              status: 'WAITING_QR' 
            });
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error instanceof Boom)
            ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
            : true;
          
          const reason = lastDisconnect?.error?.output?.statusCode;
          logger.warn(`🔌 WhatsApp sucursal ${branchId} desconectado. Razón: ${reason}`);

          this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
          this.clients.delete(branchId);
          this.pendingInits.delete(branchId);

          if (this.manualLogout.has(branchId)) {
            logger.info(`🛑 Desconexión MANUAL de sucursal ${branchId}. No se reconectará.`);
            this.manualLogout.delete(branchId);
          } else if (shouldReconnect) {
            logger.info(`🔄 Desconexión accidental. Reconectando sucursal ${branchId} en 5s...`);
            setTimeout(() => {
              this.initializeBranch(branchId).catch(err =>
                logger.error(`Error re-inicializando tras desconexión en ${branchId}:`, err)
              );
            }, 5000);
          } else {
            logger.warn(`⚠️ Sesión cerrada (logout). Necesita escanear QR nuevamente.`);
          }
        }

        if (connection === 'open') {
          logger.info(`✅ WhatsApp sucursal ${branchId} conectado!`);
          this.sessions.set(branchId, { isReady: true, qr: null, status: 'READY' });
          this.pendingInits.delete(branchId);
        }
      });

      // ── Guardar credenciales cuando cambian ──
      sock.ev.on('creds.update', saveCreds);

      // ── Handler de mensajes entrantes ──
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
          if (msg.key.fromMe) continue; // Ignorar mensajes propios
          
          const from = msg.key.remoteJid;
          const body = msg.message?.conversation 
            || msg.message?.extendedTextMessage?.text 
            || msg.message?.imageMessage?.caption
            || msg.message?.videoMessage?.caption
            || '';

          logger.info(`📩 [WA-RAW] Mensaje de ${from}: ${body?.substring(0, 20)}...`);

          if (this.messageHandler) {
            // Adaptar formato de Baileys al formato que espera el messageHandler
            const msgId = msg.key.id || `${from}-${Date.now()}`;
            const adaptedMsg = {
              from,
              body,
              fromMe: msg.key.fromMe || false,
              hasMedia: !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage || msg.message?.audioMessage),
              timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
              id: {
                _serialized: msgId,
                id: msgId,
              },
              _baileysMsg: msg, // Guardar referencia original
              // Simular interface de whatsapp-web.js
              reply: async (text) => {
                await this.sendMessage(branchId, from, text);
              }
            };

            try {
              await this.messageHandler(adaptedMsg, branchId);
            } catch (error) {
              logger.error(`Error procesando mensaje en sucursal ${branchId}:`, error);
            }
          }
        }
      });

      return sock;
    } catch (err) {
      console.error(`❌ [WHATSAPP-ERROR] Sucursal ${branchId}:`, err.message || err);
      logger.error(`❌ Error crítico iniciando sucursal ${branchId}:`, err);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'ERROR' });
      this.clients.delete(branchId);
      this.pendingInits.delete(branchId);

      logger.info(`🔄 Auto-recovery: reintentando sucursal ${branchId} en 30s...`);
      setTimeout(() => {
        this.initializeBranch(branchId).catch(e =>
          logger.error(`❌ Auto-recovery falló para sucursal ${branchId}:`, e)
        );
      }, 30000);

      return null;
    }
  }

  /**
   * Registra el handler global de mensajes
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }

  /**
   * Normaliza un número de teléfono al formato JID de WhatsApp
   */
  _normalizeJid(to) {
    if (to.includes('@')) return to;
    const clean = to.replace(/\D/g, '');
    return `${clean}@s.whatsapp.net`;
  }

  /**
   * Envía un mensaje desde una sucursal específica
   */
  async sendMessage(branchId, to, text) {
    const masterBranchId = 1;
    const sock = this.clients.get(masterBranchId);
    const session = this.sessions.get(masterBranchId);

    if (!sock) {
      logger.warn(`WhatsApp Central (Branch ${masterBranchId}): cliente no existe`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ WhatsApp sucursal ${masterBranchId} aún no está lista (isReady=false). Intentando enviar de todas formas...`);
    }

    try {
      await antiBanDelay();
      const jid = this._normalizeJid(to);

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

        for (let i = 0; i < parts.length; i++) {
          await sock.sendMessage(jid, { text: parts[i] });
          if (i < parts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        }
        return true;
      }

      // --- Envío Normal ---
      await sock.sendMessage(jid, { text });
      logger.debug(`📤 Mensaje enviado desde sucursal ${branchId} a ${jid}`);
      return true;
    } catch (error) {
      logger.error(`❌ Error enviando mensaje desde sucursal ${branchId} a ${to}:`, error);
      return false;
    }
  }

  /**
   * Envía una imagen/media desde una sucursal específica
   */
  async sendMedia(branchId, to, mediaSource, options = {}) {
    const masterBranchId = 1;
    const sock = this.clients.get(masterBranchId);
    const session = this.sessions.get(masterBranchId);

    if (!sock) {
      logger.warn(`WhatsApp Central (Branch ${masterBranchId}): cliente no existe para enviar media`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ WhatsApp sucursal ${masterBranchId} aún no está lista para media (isReady=false). Intentando enviar...`);
    }

    try {
      await antiBanDelay();
      const jid = this._normalizeJid(to);

      logger.info(`🖼️ Preparando envío de media para ${jid} desde branch ${branchId}`);

      if (mediaSource.startsWith('http')) {
        // Verificar accesibilidad
        try {
          const headResp = await axios.head(mediaSource, { timeout: 5000 });
          if (headResp.status !== 200) {
            logger.warn(`⚠️ Media URL no accesible (${headResp.status}): ${mediaSource}`);
            return false;
          }
        } catch (headErr) {
          logger.warn(`⚠️ Media URL no responde: ${mediaSource} — ${headErr.message}`);
          return false;
        }

        const response = await axios.get(mediaSource, { responseType: 'arraybuffer', timeout: 15000 });
        const buffer = Buffer.from(response.data);
        const mimetype = response.headers['content-type'] || 'image/png';

        if (options.isAudio) {
          await sock.sendMessage(jid, { 
            audio: buffer, 
            mimetype: 'audio/mp4',
            ptt: true 
          });
        } else if (mimetype.startsWith('image/')) {
          await sock.sendMessage(jid, { 
            image: buffer, 
            caption: options.caption || '',
            mimetype 
          });
        } else if (mimetype.startsWith('video/')) {
          await sock.sendMessage(jid, { 
            video: buffer, 
            caption: options.caption || '',
            mimetype 
          });
        } else {
          await sock.sendMessage(jid, { 
            document: buffer, 
            caption: options.caption || '',
            mimetype,
            fileName: mediaSource.split('/').pop() 
          });
        }
      } else {
        // Archivo local
        const buffer = fs.readFileSync(mediaSource);
        await sock.sendMessage(jid, { 
          image: buffer, 
          caption: options.caption || '' 
        });
      }

      logger.info(`📤 Media enviado exitosamente a ${jid}`);
      return true;
    } catch (error) {
      logger.warn(`⚠️ Error enviando media (Source: ${mediaSource}) a ${to}: ${error.message}`);
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
   * Envía notificación directa a un número de teléfono configurado en la sucursal.
   */
  async notifyPhone(branchId, message) {
    try {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { notificationPhone: true, notificationGroupName: true }
      });

      if (branch?.notificationPhone) {
        const phone = branch.notificationPhone.replace(/[^0-9]/g, '');
        const chatId = `${phone}@s.whatsapp.net`;
        const sent = await this.sendMessage(branchId, chatId, message);
        if (!sent) {
          logger.warn(`⚠️ Falló envío de notificación al teléfono ${phone} de sucursal ${branchId}`);
        } else {
          logger.info(`📱 Notificación enviada al teléfono ${phone} para sucursal ${branchId}`);
        }
        return sent;
      }

      logger.warn(`⚠️ Sucursal ${branchId} no tiene teléfono de notificación configurado.`);
      return false;
    } catch (error) {
      logger.error(`Error en notifyPhone para sucursal ${branchId}:`, error);
      return false;
    }
  }

  /**
   * Envía notificación a grupo (mantenido por compatibilidad, usa notifyPhone)
   */
  async notifyGroup(branchId, message) {
    return this.notifyPhone(branchId, message);
  }

  /**
   * Envía múltiples mensajes (Campaña) con control de delay
   */
  async sendBulkMessages(branchId, contacts, message, delayMs = 8000) {
    const results = [];
    logger.info(`🚀 Iniciando envío masivo para sucursal ${branchId} (${contacts.length} contactos)`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const chatId = `${contact.phone}@s.whatsapp.net`;

      try {
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, delayMs + jitter));

        const sent = await this.sendMessage(1, chatId, message);
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
    const sock = this.clients.get(branchId);
    if (sock) {
      logger.info(`🗑️ Destruyendo instancia de WhatsApp para sucursal ${branchId}...`);
      this.manualLogout.add(branchId);

      try {
        await sock.logout();
        logger.info(`✅ Logout exitoso para sucursal ${branchId}`);
      } catch (e) {
        logger.warn(`⚠️ No se pudo hacer logout limpio de sucursal ${branchId}:`, e.message);
      }

      // Limpiar archivos de auth
      const authDir = path.join(this.authDir, `branch_${branchId}`);
      try {
        if (fs.existsSync(authDir)) {
          fs.rmSync(authDir, { recursive: true });
        }
      } catch (e) {
        logger.warn(`No se pudo limpiar auth dir de sucursal ${branchId}`);
      }

      this.clients.delete(branchId);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
      return true;
    }

    this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
    return false;
  }

  /**
   * Cierra todas las sesiones activas
   */
  async destroyAll() {
    logger.info('🛑 Cerrando todas las instancias de WhatsApp...');
    for (const [branchId] of this.clients.entries()) {
      try {
        await this.destroyBranch(branchId);
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

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const { antiBanDelay } = require('../utils/helpers');
const { prisma } = require('../config/database');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

class WhatsAppService {
  constructor() {
    this.clients = new Map();
    this.sessions = new Map();
    this.pendingInits = new Set();

    this.messageHandler = null;
    this.manualLogout = new Set();
    this.initCooldown = new Map();
    this.maxPerMinute = parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20;

    this.authDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  get isReady() {
    return this.sessions.get(1)?.isReady || false;
  }

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

      logger.info('✨ Iniciando sesión maestra (Sucursal 1)...');
      await this.initializeBranch(1);
    } catch (error) {
      logger.error('❌ Error en el proceso de autostart:', error);
    }
  }

  async initializeBranch(branchId) {
    if (this.clients.has(branchId)) {
      logger.info(`ℹ️ Sucursal ${branchId} ya tiene un cliente activo.`);
      return this.clients.get(branchId);
    }

    if (this.pendingInits.has(branchId)) {
      logger.info(`⏳ Sucursal ${branchId} ya se está inicializando. Ignorando petición duplicada.`);
      return null;
    }

    const lastInit = this.initCooldown.get(branchId) || 0;
    if (Date.now() - lastInit < 10000) {
      logger.info(`⏳ Cooldown activo para sucursal ${branchId}. Esperando...`);
      return null;
    }
    this.initCooldown.set(branchId, Date.now());

    this.pendingInits.add(branchId);
    logger.info(`🚀 [WA-INIT] Iniciando whatsapp-web.js para sucursal: ${branchId}`);

    try {
      const sessionDir = path.join(this.authDir, `branch_${branchId}`);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      this.sessions.set(branchId, { isReady: false, qr: null, status: 'INITIALIZING' });

      const client = new Client({
        authStrategy: new LocalAuth({
          dataPath: sessionDir,
          clientId: `branch_${branchId}`
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
            '--disable-gpu'
          ],
          executablePath: process.env.CHROMIUM_PATH || undefined
        }
      });

      this.clients.set(branchId, client);

      client.on('qr', (qrCode) => {
        logger.info(`📱 QR Generado para sucursal ${branchId}`);
        this.sessions.set(branchId, {
          ...this.sessions.get(branchId),
          qr: qrCode,
          status: 'WAITING_QR'
        });
      });

      client.on('ready', () => {
        logger.info(`✅ WhatsApp sucursal ${branchId} conectado!`);
        this.sessions.set(branchId, { isReady: true, qr: null, status: 'READY' });
        this.pendingInits.delete(branchId);
      });

      client.on('disconnected', async (reason) => {
        logger.warn(`🔌 WhatsApp sucursal ${branchId} desconectado. Razón: ${reason}`);
        this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
        this.clients.delete(branchId);
        this.pendingInits.delete(branchId);

        if (this.manualLogout.has(branchId)) {
          logger.info(`🛑 Desconexión MANUAL de sucursal ${branchId}. No se reconectará.`);
          this.manualLogout.delete(branchId);
        } else {
          logger.info(`🔄 Desconexión accidental. Reconectando sucursal ${branchId} en 5s...`);
          setTimeout(() => {
            this.initializeBranch(branchId).catch(err =>
              logger.error(`Error re-inicializando tras desconexión en ${branchId}:`, err)
            );
          }, 5000);
        }
      });

      client.on('auth_failure', (message) => {
        logger.warn(`⚠️ Auth failure para sucursal ${branchId}: ${message}`);
        this.sessions.set(branchId, { isReady: false, qr: null, status: 'AUTH_FAILURE' });

        const sessDir = path.join(this.authDir, `branch_${branchId}`);
        try {
          if (fs.existsSync(sessDir)) {
            fs.rmSync(sessDir, { recursive: true });
            logger.info(`🗑️ Sesión eliminada para sucursal ${branchId} tras auth failure`);
          }
        } catch (e) {
          logger.warn(`⚠️ No se pudo limpiar sesión de sucursal ${branchId}:`, e.message);
        }

        setTimeout(() => {
          logger.info(`🔄 Reintentando sucursal ${branchId} tras auth failure...`);
          this.initializeBranch(branchId).catch(err =>
            logger.error(`Error re-inicializando sucursal ${branchId}:`, err)
          );
        }, 15000);
      });

      client.on('message', async (msg) => {
        if (msg.fromMe) return;

        const from = msg.from;
        if (!from || from === 'status@broadcast' || from.includes('@g.us') || from.includes('@broadcast')) return;

        const body = msg.body || '';

        logger.info(`📩 [WA-RAW] Mensaje de ${from}: ${body?.substring(0, 20)}...`);

        if (this.messageHandler) {
          const adaptedMsg = {
            from: from,
            body: body,
            fromMe: false,
            hasMedia: msg.hasMedia || false,
            timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
            id: {
              _serialized: msg.id?._serialized || `${from}-${Date.now()}`,
              id: msg.id?.id || `${from}-${Date.now()}`
            },
            _raw: msg,
            reply: async (text) => {
              await this.sendMessage(branchId, from, text);
            },
            getContact: async () => {
              try { return await msg.getContact(); }
              catch { return null; }
            },
            downloadMedia: async () => {
              try {
                if (msg.hasMedia) return await msg.downloadMedia();
              } catch { }
              return null;
            },
            notifyName: msg._data?.notifyName || msg._data?.pushName || ''
          };

          try {
            await this.messageHandler(adaptedMsg, branchId);
          } catch (error) {
            logger.error(`Error procesando mensaje en sucursal ${branchId}:`, error);
          }
        }
      });

      await client.initialize();

      return client;
    } catch (err) {
      const errMsg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err)) || 'Error desconocido';
      logger.error(`❌ Error crítico iniciando sucursal ${branchId}: ${errMsg}`);
      if (err?.stack) logger.error(`📋 Stack: ${err.stack}`);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'ERROR' });
      this.clients.delete(branchId);
      this.pendingInits.delete(branchId);

      logger.info(`🔄 Auto-recovery: reintentando sucursal ${branchId} en 30s...`);
      setTimeout(() => {
        this.initializeBranch(branchId).catch(e => {
          const eMsg = e?.message || (typeof e === 'string' ? e : JSON.stringify(e)) || 'Error desconocido';
          logger.error(`❌ Auto-recovery falló para sucursal ${branchId}: ${eMsg}`);
        });
      }, 30000);

      return null;
    }
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  _normalizeJid(to) {
    if (to.includes('@')) return to;
    const clean = to.replace(/\D/g, '');
    return `${clean}@c.us`;
  }

  async sendMessage(branchId, to, text) {
    const masterBranchId = 1;
    const client = this.clients.get(masterBranchId);
    const session = this.sessions.get(masterBranchId);

    if (!client) {
      logger.error(`❌ [SEND] WhatsApp Central (Branch ${masterBranchId}): cliente NO EXISTE — no se puede enviar a ${to}`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ [SEND] WhatsApp sucursal ${masterBranchId} aún no está lista (isReady=false). Intentando enviar de todas formas...`);
    }

    try {
      logger.info(`📤 [SEND-INICIO] Enviando a ${to} (branch ${branchId}, texto ${text.length} chars)`);
      await antiBanDelay();
      logger.info(`📤 [SEND-POST-DELAY] Delay completado, preparando envío a ${to}`);
      const chatId = this._normalizeJid(to);
      logger.info(`📤 [SEND-JID] ChatID normalizado: ${chatId}`);

      const sendWithTimeout = async (chatId, messageText, timeoutMs = 60000) => {
        return Promise.race([
          client.sendMessage(chatId, messageText),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms al enviar a ${chatId}`)), timeoutMs)
          )
        ]);
      };

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

        logger.info(`📤 [SEND-SPLIT] Mensaje dividido en ${parts.length} partes`);
        for (let i = 0; i < parts.length; i++) {
          logger.info(`📤 [SEND-PART ${i + 1}/${parts.length}] Enviando parte ${i + 1} (${parts[i].length} chars) a ${chatId}`);
          await sendWithTimeout(chatId, parts[i]);
          logger.info(`📤 [SEND-PART ${i + 1}/${parts.length}] Parte ${i + 1} enviada OK`);
          if (i < parts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        }
        logger.info(`✅ [SEND-COMPLETO] Todos los ${parts.length} partes enviadas a ${to}`);
        return true;
      }

      await sendWithTimeout(chatId, text);
      logger.info(`✅ [SEND-OK] Mensaje enviado desde sucursal ${branchId} a ${chatId} (${text.length} chars)`);
      return true;
    } catch (error) {
      logger.error(`❌ [SEND-ERROR] Error enviando mensaje desde sucursal ${branchId} a ${to}:`, error.message || error);
      return false;
    }
  }

  async sendMedia(branchId, to, mediaSource, options = {}) {
    const masterBranchId = 1;
    const client = this.clients.get(masterBranchId);
    const session = this.sessions.get(masterBranchId);

    if (!client) {
      logger.warn(`WhatsApp Central (Branch ${masterBranchId}): cliente no existe para enviar media`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ WhatsApp sucursal ${masterBranchId} aún no está lista para media (isReady=false). Intentando enviar...`);
    }

    try {
      await antiBanDelay();
      const chatId = this._normalizeJid(to);

      logger.info(`🖼️ Preparando envío de media para ${chatId} desde branch ${branchId}`);

      if (mediaSource.startsWith('http')) {
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
        const base64 = buffer.toString('base64');

        if (options.isAudio) {
          const media = new MessageMedia('audio/mp4', base64, 'audio.mp4');
          await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
        } else if (mimetype.startsWith('image/')) {
          const media = new MessageMedia(mimetype, base64, 'image');
          await client.sendMessage(chatId, media, { caption: options.caption || '' });
        } else if (mimetype.startsWith('video/')) {
          const media = new MessageMedia(mimetype, base64, 'video');
          await client.sendMessage(chatId, media, { caption: options.caption || '' });
        } else {
          const fileName = mediaSource.split('/').pop() || 'file';
          const media = new MessageMedia(mimetype, base64, fileName);
          await client.sendMessage(chatId, media, { caption: options.caption || '' });
        }
      } else {
        const buffer = fs.readFileSync(mediaSource);
        const base64 = buffer.toString('base64');
        const ext = path.extname(mediaSource).toLowerCase();
        const mimeTypes = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
          '.pdf': 'application/pdf'
        };
        const mimetype = mimeTypes[ext] || 'image/png';
        const media = new MessageMedia(mimetype, base64, path.basename(mediaSource));
        await client.sendMessage(chatId, media, { caption: options.caption || '' });
      }

      logger.info(`📤 Media enviado exitosamente a ${chatId}`);
      return true;
    } catch (error) {
      logger.warn(`⚠️ Error enviando media (Source: ${mediaSource}) a ${to}: ${error.message}`);
      return false;
    }
  }

  getAllStatuses() {
    return Object.fromEntries(this.sessions);
  }

  getBranchStatus(branchId) {
    return this.sessions.get(branchId) || { isReady: false, qr: null, status: 'NOT_FOUND' };
  }

  async notifyPhone(branchId, message) {
    try {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { notificationPhone: true, notificationGroupName: true }
      });

      if (branch?.notificationPhone) {
        const phone = branch.notificationPhone.replace(/[^0-9]/g, '');
        const chatId = `${phone}@c.us`;
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

  async notifyGroup(branchId, message) {
    return this.notifyPhone(branchId, message);
  }

  async sendBulkMessages(branchId, contacts, message, delayMs = 8000) {
    const results = [];
    logger.info(`🚀 Iniciando envío masivo para sucursal ${branchId} (${contacts.length} contactos)`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const chatId = `${contact.phone}@c.us`;

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

  async destroyBranch(branchId) {
    const client = this.clients.get(branchId);
    if (client) {
      logger.info(`🗑️ Destruyendo instancia de WhatsApp para sucursal ${branchId}...`);
      this.manualLogout.add(branchId);

      try {
        await client.destroy();
        logger.info(`✅ Destroy exitoso para sucursal ${branchId}`);
      } catch (e) {
        logger.warn(`⚠️ No se pudo destruir limpiamente sucursal ${branchId}:`, e.message);
      }

      const sessDir = path.join(this.authDir, `branch_${branchId}`);
      try {
        if (fs.existsSync(sessDir)) {
          fs.rmSync(sessDir, { recursive: true });
        }
      } catch (e) {
        logger.warn(`No se pudo limpiar sesión de sucursal ${branchId}`);
      }

      this.clients.delete(branchId);
      this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
      return true;
    }

    this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
    return false;
  }

  async destroyAll() {
    logger.info('🛑 Cerrando todas las instancias de WhatsApp...');
    for (const [branchId] of this.clients.entries()) {
      try {
        await this.destroyBranch(branchId);
        logger.info(`💨 Cliente sucursal ${branchId} destruido`);
      } catch (e) {
        logger.warn(`⚠️ Error destruyendo sesión de sucursal ${branchId}: ${e.message}`);
      }
    }
    this.clients.clear();
    this.sessions.clear();
  }
}

module.exports = new WhatsAppService();

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const { antiBanDelay, isPhoneBlocked, cleanPhoneDigits } = require('../utils/helpers');
const { prisma } = require('../config/database');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { removeChromiumLocks } = require('../utils/processCleanup');
const emailService = require('./emailService');

const DEFAULT_ADMIN_PHONE = process.env.ADMIN_PHONE || '573166575904';

class WhatsAppService {
  constructor() {
    this.clients = new Map();
    this.sessions = new Map();
    this.pendingInits = new Set();
    this._botSentIds = new Set();
    this._pendingSends = [];
    this._recentBotTexts = new Map();
    this.lidToPhoneMap = new Map();

    this.messageHandler = null;
    this.manualLogout = new Set();
    this.initCooldown = new Map();
    this.maxPerMinute = parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20;

    this.authDir = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  _trackBotMessage(id) {
    if (!id) return;
    if (!this._botSentIds) this._botSentIds = new Set();
    if (this._botSentIds.size > 5000) {
      const arr = Array.from(this._botSentIds).slice(2500);
      this._botSentIds = new Set(arr);
    }
    this._botSentIds.add(id);
  }

  _recordPendingSend(to, text) {
    const cleanPhone = String(to || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const cleanText = String(text || '').trim();
    if (!this._pendingSends) this._pendingSends = [];
    this._pendingSends.push({
      cleanPhone,
      text: cleanText,
      at: Date.now()
    });
    if (cleanText) {
      if (!this._recentBotTexts) this._recentBotTexts = new Map();
      this._recentBotTexts.set(cleanText, Date.now());
    }
    const now = Date.now();
    this._pendingSends = this._pendingSends.filter(s => now - s.at < 45000);
    if (this._recentBotTexts.size > 300) {
      for (const [txt, timestamp] of this._recentBotTexts.entries()) {
        if (now - timestamp > 90000) {
          this._recentBotTexts.delete(txt);
        }
      }
    }
  }

  _isBotOutgoing(cleanPhone, msgText) {
    const now = Date.now();
    const cleanMsg = String(msgText || '').trim();

    // 1. ¿Texto idéntico enviado por el bot recientemente?
    if (cleanMsg && this._recentBotTexts && this._recentBotTexts.has(cleanMsg)) {
      if (now - this._recentBotTexts.get(cleanMsg) < 90000) return true;
    }

    // 2. ¿Coincide con un envío pendiente del bot para este número?
    if (this._pendingSends && this._pendingSends.length > 0) {
      const matchIdx = this._pendingSends.findIndex(s => {
        const phoneMatch = !s.cleanPhone || !cleanPhone ||
          s.cleanPhone === cleanPhone ||
          s.cleanPhone.endsWith(cleanPhone) ||
          cleanPhone.endsWith(s.cleanPhone);
        const textMatch = !s.text || !cleanMsg ||
          s.text === cleanMsg ||
          cleanMsg.startsWith(s.text.substring(0, 30)) ||
          s.text.startsWith(cleanMsg.substring(0, 30));
        return phoneMatch && (textMatch || (now - s.at < 25000));
      });
      if (matchIdx !== -1) {
        this._pendingSends.splice(matchIdx, 1);
        return true;
      }
    }

    // 3. ¿El texto contiene firmas inequívocas de mensajes automáticos del bot?
    if (cleanMsg && (
      cleanMsg.includes('Soy Sofía') ||
      cleanMsg.includes('asesora de Fantasías') ||
      cleanMsg.includes('¡Tu pedido #') ||
      cleanMsg.includes('link de pago seguro por')
    )) {
      return true;
    }

    return false;
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

      // 🧹 Liberar candados huérfanos de Chromium sin borrar la sesión de WhatsApp
      removeChromiumLocks(sessionDir);

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
        try {
          const qrcodeTerminal = require('qrcode-terminal');
          qrcodeTerminal.generate(qrCode, { small: true });
        } catch (_) {}
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
        this._applyInjectedPatches(client).catch(() => {});
      });

      client.on('disconnected', async (reason) => {
        logger.warn(`🔌 WhatsApp sucursal ${branchId} desconectado. Razón: ${reason}`);
        this.sessions.set(branchId, { isReady: false, qr: null, status: 'DISCONNECTED' });
        this.clients.delete(branchId);
        this.pendingInits.delete(branchId);

        this._sendSessionAlert(branchId, reason, 'DISCONNECTED').catch(() => {});

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

        this._sendSessionAlert(branchId, message, 'AUTH_FAILURE').catch(() => {});

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

      client.on('message_create', async (msg) => {
        try {
          if (!msg.fromMe) return;

          const serializedId = msg.id?._serialized;
          if (serializedId && this._botSentIds.has(serializedId)) {
            // Ya registrado como mensaje del bot
            return;
          }

          const to = msg.to;
          if (!to || to === 'status@broadcast' || to.includes('@g.us') || to.includes('@broadcast')) return;

          const cleanPhone = to.split('@')[0].split(':')[0].replace(/\D/g, '');
          const msgBody = (msg.body || '').trim();

          // 1. ¿Es un mensaje propio del bot (reconocimiento proactivo antes de que termine el await)?
          if (this._isBotOutgoing(cleanPhone, msgBody)) {
            if (serializedId) this._trackBotMessage(serializedId);
            return;
          }

          // 2. ¿El asesor está escribiendo un comando para reactivar el bot?
          const resumeCmds = ['!bot', '#bot', '/bot', '!activar', '#activar', 'activar bot', '!auto'];
          if (resumeCmds.includes(msgBody.toLowerCase())) {
            const contact = await prisma.contact.findFirst({
              where: { phone: { contains: cleanPhone.slice(-10) } }
            });
            if (contact) {
              await prisma.conversation.updateMany({
                where: { contactId: contact.id, status: { in: ['PAUSED', 'ESCALATED'] } },
                data: { status: 'ACTIVE' }
              });
              logger.info(`🤖 [HUMAN-RESUME] Asesor reactivó el bot con comando "${msgBody}" para ${cleanPhone}`);
            }
            return;
          }

          // 3. Asesor humano respondió directamente en el WhatsApp del negocio
          logger.info(`🧑‍💼 [HUMAN-TAKEOVER] Mensaje manual de asesor detectado hacia ${cleanPhone} (Sucursal ${branchId}): "${(msg.body || '').substring(0, 30)}..."`);

          const contact = await prisma.contact.findFirst({
            where: { phone: { contains: cleanPhone.slice(-10) } }
          });

          if (contact) {
            const conversation = await prisma.conversation.findFirst({
              where: { contactId: contact.id, status: { not: 'CLOSED' } },
              orderBy: { updatedAt: 'desc' }
            });

            if (conversation) {
              if (conversation.status !== 'PAUSED') {
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { status: 'PAUSED' }
                });
                logger.info(`🤫 [HUMAN-TAKEOVER] Conversación ${conversation.id} pausada automáticamente por respuesta manual de asesor.`);
              }

              await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  role: 'ASSISTANT',
                  content: `[Asesor Humano]: ${msg.body || (msg.hasMedia ? '(Archivo multimedia enviado)' : '')}`,
                  waMessageId: serializedId,
                  messageType: msg.hasMedia ? 'media' : 'text'
                }
              });
            }
          }
        } catch (takeoverErr) {
          logger.error(`Error en detección de intervención humana (Sucursal ${branchId}):`, takeoverErr);
        }
      });

      client.on('message', async (msg) => {
        if (msg.fromMe) return;

        const from = msg.from;
        if (!from || from === 'status@broadcast' || from.includes('@g.us') || from.includes('@broadcast')) return;

        if (isPhoneBlocked(from) || isPhoneBlocked(msg.author) || isPhoneBlocked(msg._data?.from)) {
          logger.info(`🚫 [WA-RAW] Mensaje ignorado de número bloqueado: ${from}`);
          return;
        }

        const body = msg.body || '';

        logger.info(`📩 [WA-RAW] Mensaje de ${from}: ${body?.substring(0, 20)}...`);

        if (this.messageHandler) {
          const adaptedMsg = {
            from: from,
            body: body,
            fromMe: false,
            type: msg.type,
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

  /**
   * Aplica un parche en caliente en el navegador Chromium de WhatsApp Web
   * para prevenir el error:
   * "Data passed to getter must include an id property (it's how we memoize) but got undefined"
   */
  async _applyInjectedPatches(client) {
    if (!client?.pupPage) return;
    try {
      await client.pupPage.evaluate(() => {
        if (!window.WWebJS) return;
        if (window.WWebJS._patchedSendMessageForMedia) return;

        const originalSendMessage = window.WWebJS.sendMessage;
        window.WWebJS.sendMessage = async function(chat, content, options = {}) {
          try {
            // 1. Evitar que propiedades internas de media borren o sobreescriban 'id'
            if (options && options.media) {
              if (options.media.id !== undefined) delete options.media.id;
              if (options.media.__x_id !== undefined) delete options.media.__x_id;
            }

            // 2. Garantizar que chat y chat.contact tengan 'id' válido para el memoizer de WhatsApp
            if (chat) {
              const req = typeof window.require === 'function' ? window.require : null;
              const contactStore = (req ? req('WAWebCollections')?.Contact : null) || window.Store?.Contact;
              if (!chat.contact && chat.id) {
                const existing = contactStore?.get?.(chat.id);
                chat.contact = existing || { id: chat.id };
              }
              if (chat.contact && !chat.contact.id && chat.id) {
                chat.contact.id = chat.id;
              }
            }
          } catch (e) {
            console.warn('[PATCH] Error in pre-send check:', e);
          }

          return await originalSendMessage.apply(this, arguments);
        };

        // 3. Parche directo en WAWebSendMsgChatAction.addAndSendMsgToChat si está disponible
        try {
          const req = typeof window.require === 'function' ? window.require : null;
          const sendChatAction = (req ? req('WAWebSendMsgChatAction') : null) || window.Store?.SendMessage;
          if (sendChatAction && typeof sendChatAction.addAndSendMsgToChat === 'function' && !sendChatAction._memoizePatched) {
            const originalAddAndSend = sendChatAction.addAndSendMsgToChat;
            sendChatAction.addAndSendMsgToChat = function(chat, message) {
              try {
                if (message && !message.id && message.__x_id) {
                  message.id = message.__x_id;
                }
                if (chat) {
                  const contactStore = (req ? req('WAWebCollections')?.Contact : null) || window.Store?.Contact;
                  if (!chat.contact && chat.id) {
                    chat.contact = contactStore?.get?.(chat.id) || { id: chat.id };
                  }
                  if (chat.contact && !chat.contact.id && chat.id) {
                    chat.contact.id = chat.id;
                  }
                }
              } catch (_) {}
              return originalAddAndSend.apply(this, arguments);
            };
            sendChatAction._memoizePatched = true;
          }
        } catch (_) {}

        window.WWebJS._patchedSendMessageForMedia = true;
      });
      logger.info('🛡️ [WA-PATCH] Parche de envío de multimedia para WhatsApp Web verificado en Chromium');
    } catch (err) {
      logger.warn(`⚠️ [WA-PATCH] No se pudo aplicar parche en Chromium: ${err.message}`);
    }
  }

  /**
   * Resuelve el JID de destino óptimo.
   * Si es un ID de privacidad (@lid), intenta mapearlo al número de teléfono real (@c.us)
   * para evitar fallos del motor interno de media en WhatsApp Web.
   */
  async resolveDestinationJid(branchId, to) {
    if (!to) return to;
    const raw = String(to).trim();
    if (raw.includes('@c.us')) return raw;

    if (raw.includes('@lid')) {
      const cached = this.lidToPhoneMap.get(raw);
      if (cached) {
        logger.info(`🔍 [LID-RESOLVE] Destino obtenido desde caché: ${raw} -> ${cached}`);
        return cached;
      }

      const targetBranch = branchId ? parseInt(branchId) : 1;
      const client = this.clients.get(targetBranch) || this.clients.get(1);

      if (client) {
        // Intento 1: getContactLidAndPhone de whatsapp-web.js
        try {
          if (typeof client.getContactLidAndPhone === 'function') {
            const list = await client.getContactLidAndPhone([raw]);
            const pn = list?.[0]?.pn;
            if (pn && pn.includes('@c.us')) {
              logger.info(`🔍 [LID-RESOLVE] Resuelto vía getContactLidAndPhone: ${raw} -> ${pn}`);
              this.lidToPhoneMap.set(raw, pn);
              return pn;
            }
          }
        } catch (e) {
          logger.debug(`[LID-RESOLVE] getContactLidAndPhone no disponible para ${raw}: ${e.message}`);
        }

        // Intento 2: getContactById
        try {
          if (typeof client.getContactById === 'function') {
            const contact = await client.getContactById(raw);
            if (contact?.number && !contact.number.includes('lid') && contact.number.length >= 7) {
              const clean = contact.number.replace(/\D/g, '');
              const jid = `${clean}@c.us`;
              logger.info(`🔍 [LID-RESOLVE] Resuelto vía getContactById: ${raw} -> ${jid}`);
              this.lidToPhoneMap.set(raw, jid);
              return jid;
            }
          }
        } catch (e) {
          logger.debug(`[LID-RESOLVE] getContactById falló para ${raw}: ${e.message}`);
        }

        // Intento 3: Inspeccionar en Puppeteer directamente
        try {
          if (client.pupPage) {
            const directPn = await client.pupPage.evaluate((lid) => {
              try {
                if (window.Store?.LidUtils?.getPhoneNumber) {
                  const res = window.Store.LidUtils.getPhoneNumber(lid);
                  if (res) return res._serialized || String(res);
                }
                const contact = window.Store?.Contact?.get(lid);
                if (contact?.phoneNumber) return contact.phoneNumber;
              } catch (_) {}
              return null;
            }, raw);

            if (directPn) {
              const clean = directPn.replace(/\D/g, '');
              if (clean.length >= 7) {
                const jid = `${clean}@c.us`;
                logger.info(`🔍 [LID-RESOLVE] Resuelto vía Store.LidUtils: ${raw} -> ${jid}`);
                this.lidToPhoneMap.set(raw, jid);
                return jid;
              }
            }
          }
        } catch (e) {
          logger.debug(`[LID-RESOLVE] Puppeteer evaluation falló para ${raw}: ${e.message}`);
        }
      }

      // Intento 4: Consultar en CRM Database por deliveryPhone
      try {
        const crmContact = await prisma.contact.findFirst({
          where: {
            OR: [
              { phone: raw },
              { phone: raw.replace('@lid', '') }
            ]
          }
        });
        if (crmContact?.deliveryPhone) {
          const clean = crmContact.deliveryPhone.replace(/\D/g, '');
          if (clean.length >= 10) {
            const withPrefix = clean.startsWith('57') ? clean : `57${clean}`;
            const jid = `${withPrefix}@c.us`;
            logger.info(`🔍 [LID-RESOLVE] Resuelto vía CRM deliveryPhone: ${raw} -> ${jid}`);
            this.lidToPhoneMap.set(raw, jid);
            return jid;
          }
        }
      } catch (e) {
        logger.debug(`[LID-RESOLVE] CRM lookup falló para ${raw}: ${e.message}`);
      }
    }

    return this._normalizeJid(raw);
  }

  _normalizeJid(to) {
    if (to.includes('@')) return to;
    const clean = to.replace(/\D/g, '');
    return `${clean}@c.us`;
  }

  async sendMessage(branchId, to, text, options = {}) {
    if (isPhoneBlocked(to)) {
      logger.warn(`🚫 [SEND-BLOCKED] Intento de envío cancelado para número bloqueado: ${to}`);
      return false;
    }

    const targetBranch = branchId ? parseInt(branchId) : 1;
    const client = this.clients.get(targetBranch) || this.clients.get(1);
    const session = this.sessions.get(targetBranch) || this.sessions.get(1);

    if (!client) {
      logger.error(`❌ [SEND] WhatsApp (Branch ${targetBranch}/1): cliente NO EXISTE — no se puede enviar a ${to}`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ [SEND] WhatsApp sucursal ${targetBranch} aún no está lista (isReady=false). Intentando enviar de todas formas...`);
    }

    try {
      // Registrar envío pendiente ANTES de cualquier retardo para evitar falsos positivos de takeover
      this._recordPendingSend(to, text);

      logger.info(`📤 [SEND-INICIO] Enviando a ${to} (branch ${targetBranch}, texto ${text.length} chars)`);
      await antiBanDelay();
      // Resolver destinatario óptimo (mapea @lid a @c.us si es posible)
      const resolvedJid = await this.resolveDestinationJid(targetBranch, to);
      const chatId = resolvedJid || this._normalizeJid(to);
      logger.info(`📤 [SEND-JID] ChatID normalizado: ${chatId} (original: ${to})`);

      const isLid = chatId.endsWith('@lid');
      const defaultTimeout = isLid ? 15000 : 60000;

      const sendWithTimeout = async (chatId, messageText, timeoutMs = defaultTimeout) => {
        this._recordPendingSend(chatId, messageText);
        const sent = await Promise.race([
          client.sendMessage(chatId, messageText),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms al enviar a ${chatId}`)), timeoutMs)
          )
        ]);
        if (sent?.id?._serialized) {
          this._trackBotMessage(sent.id._serialized);
        }
        return sent;
      };

      // Los avisos al dueño viajan completos. El corte corto es solo para el chat con el cliente.
      const maxLength = options.singleMessage ? 4000 : 450;
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
          this._recordPendingSend(chatId, parts[i]);
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
    if (isPhoneBlocked(to)) {
      logger.warn(`🚫 [SEND-BLOCKED] Intento de envío de media cancelado para número bloqueado: ${to}`);
      return false;
    }

    const targetBranch = branchId ? parseInt(branchId) : 1;
    const client = this.clients.get(targetBranch) || this.clients.get(1);
    const session = this.sessions.get(targetBranch) || this.sessions.get(1);

    if (!client) {
      logger.warn(`WhatsApp (Branch ${targetBranch}): cliente no existe para enviar media`);
      return false;
    }
    if (!session?.isReady) {
      logger.warn(`⚠️ WhatsApp sucursal ${targetBranch} aún no está lista para media (isReady=false). Intentando enviar...`);
    }

    try {
      this._recordPendingSend(to, options.caption || '[Media]');
      await antiBanDelay();

      // Resolver destinatario óptimo (mapea @lid a @c.us si es posible)
      const resolvedJid = await this.resolveDestinationJid(targetBranch, to);
      const chatId = resolvedJid || this._normalizeJid(to);

      logger.info(`🖼️ Preparando envío de media para ${chatId} (original: ${to}) desde branch ${branchId}`);

      // Aplicar parche preventivo de memoize en Chromium
      await this._applyInjectedPatches(client);

      let mediaBuffer;
      let mimetype;
      let filename = 'file';

      if (mediaSource.startsWith('http')) {
        try {
          const headResp = await axios.head(mediaSource, { timeout: 5000 });
          if (headResp.status !== 200) {
            logger.warn(`⚠️ Media URL no accesible (${headResp.status}): ${mediaSource}`);
            return await this._sendMediaFallback(branchId, to, mediaSource, options.caption);
          }
        } catch (headErr) {
          logger.warn(`⚠️ Media URL no responde: ${mediaSource} — ${headErr.message}`);
          return await this._sendMediaFallback(branchId, to, mediaSource, options.caption);
        }

        const response = await axios.get(mediaSource, { responseType: 'arraybuffer', timeout: 15000 });
        mediaBuffer = Buffer.from(response.data);
        mimetype = response.headers['content-type'] || 'image/png';
        filename = mediaSource.split('/').pop()?.split('?')[0] || 'imagen.jpg';
      } else {
        mediaBuffer = fs.readFileSync(mediaSource);
        const ext = path.extname(mediaSource).toLowerCase();
        const mimeTypes = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
          '.pdf': 'application/pdf'
        };
        mimetype = mimeTypes[ext] || 'image/png';
        filename = path.basename(mediaSource);
      }

      const base64 = mediaBuffer.toString('base64');
      const media = new MessageMedia(mimetype, base64, filename);

      let sentMedia = null;
      let sendSuccess = false;

      // Intento 1: Envío normal de MessageMedia
      try {
        const sendOptions = { caption: options.caption || '' };
        if (options.isAudio) sendOptions.sendAudioAsVoice = true;

        sentMedia = await client.sendMessage(chatId, media, sendOptions);
        if (sentMedia?.id?._serialized) this._trackBotMessage(sentMedia.id._serialized);
        sendSuccess = true;
        logger.info(`📤 Media enviado exitosamente a ${chatId}`);
      } catch (firstErr) {
        logger.warn(`⚠️ Error en primer intento de envío de media a ${chatId}: ${firstErr.message}`);

        // Intento 2: Si falló en chatId resuelto o LID, intentar envío como documento
        try {
          logger.info(`🔄 [SEND-MEDIA-RETRY] Intentando envío como documento a ${chatId}...`);
          sentMedia = await client.sendMessage(chatId, media, {
            caption: options.caption || '',
            sendMediaAsDocument: true
          });
          if (sentMedia?.id?._serialized) this._trackBotMessage(sentMedia.id._serialized);
          sendSuccess = true;
          logger.info(`📤 Media enviado exitosamente como documento a ${chatId}`);
        } catch (docErr) {
          logger.warn(`⚠️ Intento como documento también falló: ${docErr.message}`);
        }
      }

      // Si ambos intentos con MessageMedia fallaron (ej. bug del memoizer de WhatsApp Web en LIDs)
      // Activar Fallback de Entrega Garantizada (Layer 4):
      if (!sendSuccess) {
        logger.info(`📸 [MEDIA-FALLBACK] Activando envío garantizado de foto mediante enlace enriquecido para ${to}`);
        return await this._sendMediaFallback(branchId, to, mediaSource, options.caption);
      }

      return true;
    } catch (error) {
      logger.warn(`⚠️ Error general enviando media (Source: ${mediaSource}) a ${to}: ${error.message}`);
      return await this._sendMediaFallback(branchId, to, mediaSource, options.caption);
    }
  }

  /**
   * Fallback garantizado cuando WhatsApp Web no puede procesar el blob multimedia:
   * Envía el mensaje con la URL directa de la imagen (Cloudinary) y su descripción,
   * permitiendo que WhatsApp genere la vista previa de enlace enriquecida y el cliente
   * reciba la foto sin falta.
   */
  async _sendMediaFallback(branchId, to, mediaSource, caption = '') {
    try {
      if (!mediaSource.startsWith('http')) return false;
      const captionText = caption ? `\n\n${caption}` : '';
      const fallbackMsg = `📸 *Foto del producto:*\n${mediaSource}${captionText}`;
      logger.info(`📲 [SEND-MEDIA-FALLBACK] Entregando enlace de imagen a ${to}`);
      const ok = await this.sendMessage(branchId, to, fallbackMsg);
      if (ok) {
        logger.info(`✅ [SEND-MEDIA-FALLBACK-OK] Foto entregada con éxito como enlace enriquecido a ${to}`);
        return true;
      }
      return false;
    } catch (fallbackErr) {
      logger.error(`❌ [SEND-MEDIA-FALLBACK-ERR] Error entregando enlace alternativo a ${to}:`, fallbackErr);
      return false;
    }
  }

  getAllStatuses() {
    return Object.fromEntries(this.sessions);
  }

  /** Estado apto para endpoints públicos: sin QR ni datos internos de la sesión. */
  getPublicStatuses() {
    return Object.fromEntries(
      [...this.sessions.entries()].map(([branchId, s]) => [
        branchId,
        { isReady: !!s?.isReady, status: s?.status || 'UNKNOWN' },
      ])
    );
  }

  getBranchStatus(branchId) {
    return this.sessions.get(branchId) || { isReady: false, qr: null, status: 'NOT_FOUND' };
  }

  async notifyPhone(branchId, message) {
    try {
      let phone = null;
      if (branchId) {
        const branch = await prisma.branch.findUnique({
          where: { id: branchId },
          select: { notificationPhone: true, notificationGroupName: true }
        });
        if (branch?.notificationPhone) {
          phone = cleanPhoneDigits(branch.notificationPhone);
        }
      }

      // Si la sede no tiene teléfono configurado, enviar siempre al administrador maestro
      if (!phone) {
        phone = cleanPhoneDigits(DEFAULT_ADMIN_PHONE);
      }

      const chatId = `${phone}@c.us`;
      const sent = await this.sendMessage(branchId || 1, chatId, message, { singleMessage: true });
      if (!sent) {
        logger.warn(`⚠️ Falló envío de notificación al teléfono ${phone} de sucursal ${branchId}`);
      } else {
        logger.info(`📱 Notificación enviada al teléfono ${phone} para sucursal ${branchId}`);
      }
      return sent;
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

  async _sendSessionAlert(branchId, reason, type = 'DISCONNECTED') {
    try {
      const alertEmail = process.env.ALERT_EMAIL || process.env.ADMIN_EMAIL;
      const adminUser = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' },
        select: { email: true }
      });
      const targetEmail = alertEmail || adminUser?.email;
      if (!targetEmail) return;

      const subject = type === 'AUTH_FAILURE'
        ? `🚨 [URGENTE] Fallo de Autenticación WhatsApp - Sucursal ${branchId}`
        : `⚠️ Desconexión de WhatsApp - Sucursal ${branchId}`;

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #f5c6cb; border-radius: 8px;">
          <h2 style="color: #d63384;">Alerta Chatbot Fantasías</h2>
          <p>Se ha detectado una desconexión o fallo en la sesión de WhatsApp de la <strong>Sucursal ${branchId}</strong>:</p>
          <p style="background: #f8d7da; padding: 12px; border-radius: 4px; font-weight: bold; color: #721c24;">
            Evento: ${type}<br>Detalle: ${reason || 'Sin información adicional'}
          </p>
          <p>Si no se reconecta automáticamente en unos minutos, por favor ingresa al panel administrativo para escanear el código QR.</p>
        </div>
      `;

      await emailService.sendEmail(targetEmail, subject, html);
    } catch (err) {
      logger.warn(`No se pudo enviar alerta de email para sucursal ${branchId}: ${err.message}`);
    }
  }
}

module.exports = new WhatsAppService();

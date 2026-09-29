// ─────────────────────────────────────────────────────────
//  CONTROLLER: Mensajes WhatsApp — Flujo principal
// ─────────────────────────────────────────────────────────
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const wompiService = require('../services/wompiService');
const catalogService = require('../services/catalogService');
const transcriptionService = require('../services/transcriptionService');
const postSaleService = require('../services/postSaleService');
const ownerAlertService = require('../services/ownerAlertService');
const shippingService = require('../services/shippingService');
const { mergeSaleState } = require('../ai/saleState');
const { prisma } = require('../config/database');
const { isWorkingHours, formatCOP } = require('../utils/helpers');
const crypto = require('crypto');

// Ventana para agrupar ráfagas: el cliente suele escribir 2-3 mensajes seguidos
const BURST_WINDOW_MS = parseInt(process.env.MESSAGE_BURST_WINDOW_MS || '4000', 10);
const ADMIN_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_LOCK_MS = 60 * 60 * 1000;

class MessageController {
  constructor() {
    this.processedMessages = new Set();
    // Cola por chat: agrupa mensajes seguidos y encola los que llegan mientras se responde
    this.chatQueues = new Map();
    this.bootTime = Date.now();
    this.adminRegistrationFailures = new Map();
  }

  _safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  _isAdminRegistrationLocked(id) {
    const entry = this.adminRegistrationFailures.get(id);
    if (!entry) return false;
    if (Date.now() - entry.firstAt > ADMIN_LOCK_MS) {
      this.adminRegistrationFailures.delete(id);
      return false;
    }
    return entry.count >= ADMIN_MAX_FAILED_ATTEMPTS;
  }

  _registerAdminFailure(id) {
    const entry = this.adminRegistrationFailures.get(id);
    if (!entry || Date.now() - entry.firstAt > ADMIN_LOCK_MS) {
      this.adminRegistrationFailures.set(id, { count: 1, firstAt: Date.now() });
    } else {
      entry.count += 1;
    }
  }

  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = (msg.body || '').trim();
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    if (!chatId || chatId === 'status@broadcast' || chatId.includes('@g.us') || msg.fromMe || (!body && !msg.hasMedia)) return;

    const msgTimestamp = msg.timestamp ? msg.timestamp * 1000 : Date.now();
    logger.info(`📩 [MSG-IN] Recibido de ${chatId} (Timestamp: ${new Date(msgTimestamp).toLocaleString()})`);

    if (this.processedMessages.has(msgId)) return;
    this.processedMessages.add(msgId);
    setTimeout(() => this.processedMessages.delete(msgId), 60000);

    this._enqueue(chatId, msg, branchId);
  }

  _enqueue(chatId, msg, branchId) {
    let queue = this.chatQueues.get(chatId);
    if (!queue) {
      queue = { items: [], timer: null, processing: false };
      this.chatQueues.set(chatId, queue);
    }
    queue.items.push({ msg, branchId });

    // Si ya se está respondiendo, el mensaje espera y se procesa al terminar
    if (queue.processing) {
      logger.info(`📥 [QUEUE] ${chatId}: mensaje encolado mientras se responde el anterior (${queue.items.length} en cola).`);
      return;
    }
    clearTimeout(queue.timer);
    queue.timer = setTimeout(() => this._drain(chatId), BURST_WINDOW_MS);
  }

  async _drain(chatId) {
    const queue = this.chatQueues.get(chatId);
    if (!queue || queue.processing) return;
    if (queue.items.length === 0) {
      this.chatQueues.delete(chatId);
      return;
    }

    queue.processing = true;
    const batch = queue.items.splice(0);
    if (batch.length > 1) logger.info(`🧩 [BURST] ${chatId}: agrupando ${batch.length} mensajes seguidos en una sola respuesta.`);

    try {
      await this._processBatch(chatId, batch);
    } catch (error) {
      logger.error(`❌ [QUEUE-ERR] ${chatId}: ${error.stack || error.message}`);
    } finally {
      queue.processing = false;
      if (queue.items.length > 0) {
        queue.timer = setTimeout(() => this._drain(chatId), Math.round(BURST_WINDOW_MS / 2));
      } else {
        this.chatQueues.delete(chatId);
      }
    }
  }

  /**
   * Convierte el lote en texto: captions, textos y notas de voz transcritas.
   * La última imagen del lote se envía a la IA con visión.
   */
  async _resolveBatchContent(chatId, batch) {
    const parts = [];
    let mediaData = null;
    let audioFailed = false;

    for (const { msg } of batch) {
      let text = (msg.body || '').trim();

      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media?.mimetype?.startsWith('image/')) {
            mediaData = { data: media.data, mimetype: media.mimetype };
            logger.info(`📸 [MEDIA] Imagen recibida de ${chatId} (${media.mimetype})`);
            if (!text) text = '[Imagen]';
          } else if (media && transcriptionService.isAudio(msg, media)) {
            const transcript = await transcriptionService.transcribe(media);
            if (transcript) {
              text = `[Nota de voz] ${transcript}`;
            } else {
              audioFailed = true;
            }
          }
        } catch (mediaError) {
          logger.error(`❌ Error descargando media de ${chatId}:`, mediaError);
        }
      }

      if (text) parts.push(text);
    }

    const textParts = parts.filter(p => p !== '[Imagen]');
    const body = textParts.join('\n').trim();
    return { parts, body, mediaData, audioFailed };
  }

  async _processBatch(chatId, batch) {
    const { msg, branchId } = batch[batch.length - 1];

    try {
      // ── 0. ¿NÚMERO BLOQUEADO? ────────────────────────────────
      if (batch.some(({ msg: m }) => this._isMessageBlocked(chatId, m))) {
        logger.info(`🚫 [BLOCKED] Mensaje ignorado de ${chatId}`);
        return;
      }

      const { parts, body, mediaData, audioFailed } = await this._resolveBatchContent(chatId, batch);
      if (!body && !mediaData && !audioFailed) return;

      logger.info(`📨 [MSG-IN] ${chatId}: "${body.substring(0, 40)}..."`);
      const cleanPhone = chatId.split('@')[0];

      // ── 1. ¿ES EMPLEADO? ─────────────────────────────────────
      const employee = await prisma.employeeAccess.findFirst({
        where: { phone: cleanPhone }
      });

      if (employee) {
        if (!body) return;
        logger.info(`👷 [EMPLOYEE] Mensaje de ${employee.name} (${chatId})`);
        const employeeResponse = await aiService.generateEmployeeResponse(body, branchId);
        await whatsappService.sendMessage(branchId, chatId, employeeResponse.response);
        return;
      }

      // ── 1b. ¿ES EL DUEÑO/ADMIN? ─────────────────────────────
      if (body && await this._handleAdminMessage(msg, chatId, cleanPhone, body, branchId)) return;

      // ── 2. CRM Y CONVERSACIÓN ────────────────────────────────
      let contact = await crmService.findOrCreateContact(chatId, branchId);
      if (contact?.isBlocked || this._isPhoneBlocked(contact?.phone)) {
        logger.info(`🚫 [BLOCKED-CRM] Contacto en CRM bloqueado: ${contact?.phone || chatId}`);
        return;
      }
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // Capturar nombre push de WhatsApp automáticamente si el contacto no tiene nombre
      let pushName = msg._data?.notifyName || msg.notifyName || msg._data?.pushName;
      if (!pushName && typeof msg.getContact === 'function') {
        try {
          const contactObj = await msg.getContact();
          pushName = contactObj?.pushname || contactObj?.name;
        } catch (err) {
          logger.error(`❌ Error al obtener contacto de WhatsApp para ${chatId}:`, err);
        }
      }
      if (pushName && (!contact.name || contact.name === 'Sin nombre')) {
        await crmService.updateContactInfo(contact.id, { name: pushName });
        contact.name = pushName;
        logger.info(`📱 [PUSH-NAME] Nombre capturado automáticamente de WhatsApp: "${pushName}" para ${chatId}`);
      }

      if (body) {
        ownerAlertService.checkIncoming({
          contact, conversation, branchId, text: body, previousMessageAt: contact.lastMessageAt,
        }).catch(err => logger.warn(`⚠️ [OWNER-ALERT] incoming: ${err.message}`));
      }

      const partsToSave = parts.length ? parts : (audioFailed ? ['[Nota de voz sin transcribir]'] : []);
      const saveIncoming = async () => {
        for (const part of partsToSave) {
          await crmService.saveMessage(conversation.id, 'USER', part);
        }
      };

      // ── 3. VERIFICAR HORARIO LABORAL ────────────────────────
      const workingStatus = await isWorkingHours(branchId);
      if (!workingStatus.isWorking) {
        logger.info(`🌙 [OFF-HOURS] Mensaje recibido de ${chatId} (Razón: ${workingStatus.reason}). Guardando para mañana.`);
        await saveIncoming();
        await crmService.patchContext(conversation.id, (ctx) => ({ ...ctx, pendingOfflineReply: true }));
        // No enviamos mensaje automático para evitar despertar/molestar al cliente de noche
        return;
      }

      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        // Si lleva más de 10 minutos escalado sin respuesta humana, reactivar automáticamente
        const lastAssistantMsg = [...(conversation.messages || [])].reverse().find(m => m.role === 'ASSISTANT');
        const minutesSinceLastResponse = lastAssistantMsg
          ? (Date.now() - new Date(lastAssistantMsg.createdAt).getTime()) / (1000 * 60)
          : 999;

        if (minutesSinceLastResponse > 10) {
          logger.info(`🔄 [AUTO-REACTIVATE] Chat ${chatId} escalado hace ${Math.round(minutesSinceLastResponse)}min sin respuesta humana. Reactivando bot.`);
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'ACTIVE' }
          });
        } else {
          logger.info(`🤫 [MSG] Chat pausado/escalado para ${chatId} (${Math.round(minutesSinceLastResponse)}min). Esperando humano.`);
          await saveIncoming();
          return;
        }
      }

      await saveIncoming();

      // Nota de voz que no se pudo transcribir y nada más: pedir amablemente que escriba
      if (!body && !mediaData) {
        const askText = 'Ay, no alcancé a escuchar bien tu nota de voz 🙈\n\n¿Me la escribes porfa? Así te ayudo de una 💜';
        await whatsappService.sendMessage(branchId, chatId, askText);
        await crmService.saveMessage(conversation.id, 'ASSISTANT', askText);
        return;
      }

      const messageHistory = conversation.messages || [];
      const aiResult = await aiService.generateResponse(body, contact, messageHistory, branchId, false, mediaData, { conversation });

      if (aiResult?.isFallback || aiResult?.flow === 'FALLBACK_RATE_LIMIT') {
        ownerAlertService.onAiFailure({ branchId, reason: 'Límite de uso / saldo de la API de IA agotado (rate limit)' }).catch(() => {});
      }

      if (!aiResult?.response) {
        logger.warn(`⚠️ [MSG] IA no generó texto para ${chatId}`);
        return;
      }

      await this.processAiResult({ aiResult, contact, conversation, chatId, branchId, body, messageHistory });
    } catch (error) {
      logger.error(`❌ [CRITICAL-ERR] ${chatId}: ${error.stack}`);
      whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Ya te conecto con un compañero! 😊').catch(() => {});
      ownerAlertService.onAiFailure({ branchId, reason: `Error al responder a ${chatId.split('@')[0]}: ${error.message}` }).catch(() => {});
    }
  }

  /**
   * Detecta al dueño/admin (por teléfono o LID) y le responde en modo admin.
   * Devuelve true si el mensaje fue atendido aquí.
   */
  async _handleAdminMessage(msg, chatId, cleanPhone, body, branchId) {
    const allBranches = await prisma.branch.findMany({
      select: { id: true, notificationPhone: true, adminLids: true }
    });

    const lidMatches = (b, target) => {
      try {
        const lids = JSON.parse(b.adminLids || '[]');
        return lids.some(e => (typeof e === 'string' ? e : e.lid) === target);
      } catch { return false; }
    };

    let matchedAdmin = allBranches.find(b => {
      const phone = b.notificationPhone?.replace(/[^0-9]/g, '');
      return phone && phone === cleanPhone;
    });
    if (!matchedAdmin) matchedAdmin = allBranches.find(b => lidMatches(b, cleanPhone));
    if (!matchedAdmin && msg._originalLid) {
      const originalClean = msg._originalLid.split('@')[0];
      matchedAdmin = allBranches.find(b => lidMatches(b, originalClean));
    }

    // Comando /admin para registrar LID desde WhatsApp Web (protegido con PIN)
    if (!matchedAdmin && body.trim().startsWith('/admin')) {
      const registrationPin = String(process.env.ADMIN_REGISTRATION_PIN || '').trim();
      if (!registrationPin) {
        await whatsappService.sendMessage(branchId, chatId, `🔒 El registro de administradores por WhatsApp está desactivado. Agrega tu acceso desde el panel (Sedes → Admins).`);
        return true;
      }
      if (this._isAdminRegistrationLocked(cleanPhone)) return true;

      const parts = body.trim().split(/\s+/);
      const targetPhone = parts[1]?.replace(/[^0-9]/g, '');
      const pin = parts[2] || '';
      if (!targetPhone || !pin) {
        await whatsappService.sendMessage(branchId, chatId, `📝 Para registrarte como admin, envía: /admin [número de la sede] [PIN] [tu nombre]\nEjemplo: /admin 573166575904 1234 Carlos`);
        return true;
      }
      const targetBranch = allBranches.find(b => b.notificationPhone?.replace(/[^0-9]/g, '') === targetPhone);
      if (!targetBranch || !this._safeEqual(pin, registrationPin)) {
        this._registerAdminFailure(cleanPhone);
        logger.warn(`🚫 [ADMIN-REGISTER] Intento fallido desde ${cleanPhone} (sede ${targetPhone})`);
        await whatsappService.sendMessage(branchId, chatId, `❌ Datos de registro inválidos.`);
        return true;
      }
      try {
        const currentLids = JSON.parse(targetBranch.adminLids || '[]');
        if (!currentLids.some(e => e.lid === cleanPhone)) {
          const adminName = parts.slice(3).join(' ') || 'Admin';
          currentLids.push({ lid: cleanPhone, name: adminName });
          await prisma.branch.update({
            where: { id: targetBranch.id },
            data: { adminLids: JSON.stringify(currentLids) }
          });
          await whatsappService.sendMessage(branchId, chatId, `✅ LID registrado correctamente para la sede ${targetBranch.id}. Ya puedes usar el bot como admin.`);
          logger.info(`👑 [ADMIN-REGISTER] LID ${cleanPhone} registrado vía comando /admin para sede ${targetBranch.id}`);
          ownerAlertService.onAdminRegistered({ branchId: targetBranch.id, lid: cleanPhone, name: adminName }).catch(() => {});
        } else {
          await whatsappService.sendMessage(branchId, chatId, `ℹ️ Tu LID ya está registrado para la sede ${targetBranch.id}.`);
        }
        return true;
      } catch (e) {
        logger.error('Error registrando LID:', e);
        return false;
      }
    }

    if (matchedAdmin) {
      logger.info(`👑 [ADMIN] Mensaje del dueño (${chatId}) - Branch ${matchedAdmin.id}`);
      const adminResponse = await aiService.generateAdminResponse(body, branchId);
      await whatsappService.sendMessage(branchId, chatId, adminResponse.response);
      return true;
    }
    return false;
  }

  /**
   * Ejecuta todo lo que la IA decidió: redes de seguridad, captura de datos,
   * ficha de venta, envío de la respuesta, pedidos contraentrega y links Wompi.
   * Se usa tanto en tiempo real como para las respuestas fuera de horario.
   */
  async processAiResult({ aiResult, contact, conversation, chatId, branchId, body = '', messageHistory = [] }) {
      const actions = aiResult.actions || {};
      this._preferClientPaymentMethod(actions, body, messageHistory);
      logger.debug(`🔍 [ACTIONS] Para ${chatId}: contraentrega=${actions.shouldCreateContraEntrega}, closeSale=${actions.shouldCloseSale}, productos=${JSON.stringify(actions.productsToSell)}, addr=${actions.capturedAddress}, city=${actions.capturedCity}`);

      const lastPurchaseAt = conversation?.context?.sale?.lastPurchase?.at;
      const purchasedRecently = lastPurchaseAt && (Date.now() - new Date(lastPurchaseAt).getTime() < 30 * 60 * 1000);

      // SAFETY NET ACTIVO: Si la IA dice en texto que va a registrar el pedido contraentrega pero no usó la etiqueta,
      // activar el pedido automáticamente extrayendo el producto del texto de la IA.
      // IMPORTANTE: Solo aplica para contraentrega. Si menciona Wompi/transferencia/link, NO activar contraentrega.
      if (!purchasedRecently && !actions.shouldCreateContraEntrega && !actions.shouldCloseSale) {
        const aiText = (aiResult.response || '').toLowerCase();
        
        // Detectar si es pago por Wompi/transferencia (NO contraentrega)
        const isWompiPayment = (
          aiText.includes('link') || aiText.includes('wompi') || 
          aiText.includes('transferencia') || aiText.includes('pago online') ||
          aiText.includes('pago seguro') || aiText.includes('link de pago') ||
          aiText.includes('nequi') || aiText.includes('daviplata')
        );

        const impliesContraentrega = !isWompiPayment && (
          (aiText.includes('registrar tu pedido') || aiText.includes('contra entrega') || aiText.includes('contraentrega') || aiText.includes('pagar en efectivo') || aiText.includes('pago en efectivo')) &&
          (aiText.includes('dirección') || aiText.includes('entrega') || aiText.includes('enviar') || aiText.includes('pedido'))
        );

        // SAFETY NET para Wompi: si la IA habla de generar el link pero no usó [CERRAR_VENTA]
        const impliesWompiClose = isWompiPayment && (
          aiText.includes('voy a generar') || aiText.includes('proceder') || 
          aiText.includes('generar tu link') || aiText.includes('link de pago')
        );

        if (impliesContraentrega) {
          logger.warn(`⚠️ [SAFETY-NET] IA habla de contraentrega sin etiqueta — activando rescate automático. Texto: "${(aiResult.response || '').substring(0, 150)}"`);
          
          // Extraer nombre de producto del texto de la IA
          const aiFullText = aiResult.response || '';
          const productPatterns = [
            // Patrón 1: "- *Nombre Producto* por $precio"
            /[-•]\s*\*?([^*\n$]{5,60}?)\*?\s+por\s+\$/i,
            // Patrón 2: "pedido del/de Nombre Producto para/por/a/en/."
            /pedido\s+del?\s+([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+por|\s+a\s|\s+en\s|\.|,|\n)/i,
            // Patrón 3: "registrar.*pedido.*del Nombre" (orden flexible)
            /registrar[^.]*pedido[^.]*del?\s+([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+por|\s+a\s|\s+en\s|\.|,|\n)/i,
            // Patrón 4: "enviaremos/enviaré el/la Nombre para/a/por"
            /enviar(?:emos|é|ás)?\s+(?:el\s+|la\s+)?([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+a\s|\s+por|\s+en\s|\.|,|\n)/i,
            // Patrón 5: nombre con código de modelo (ej: "Vibrador Zenobia XHH-190854")
            /([A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s]{3,40}[A-Z0-9]{2,6}[-][A-Z0-9]{2,10})/,
          ];

          let rescuedProduct = null;
          for (const pattern of productPatterns) {
            const match = aiFullText.match(pattern);
            if (match && match[1]) {
              rescuedProduct = match[1].trim().replace(/[*_]/g, '');
              break;
            }
          }
          
          // Si no encontramos en la IA, buscar en el historial reciente
          if (!rescuedProduct) {
            const recentAI = messageHistory.filter(m => m.role === 'ASSISTANT').slice(-5);
            for (const msg of recentAI.reverse()) {
              for (const pattern of productPatterns) {
                const match = (msg.content || '').match(pattern);
                if (match && match[1]) {
                  rescuedProduct = match[1].trim().replace(/[*_]/g, '');
                  break;
                }
              }
              if (rescuedProduct) break;
            }
          }

          // Último recurso: el producto que la ficha de venta tiene como interés
          if (!rescuedProduct) {
            const saleInterest = conversation?.context?.sale?.interestProducts;
            if (saleInterest?.length) rescuedProduct = saleInterest[saleInterest.length - 1];
          }
          
          if (rescuedProduct) {
            logger.info(`✅ [SAFETY-NET] Producto rescatado: "${rescuedProduct}" — activando shouldCreateContraEntrega`);
            actions.shouldCreateContraEntrega = true;
            actions.productsToSell = [rescuedProduct];
          } else {
            logger.warn(`⚠️ [SAFETY-NET] No se pudo extraer el producto del texto. Se requerirá intervención manual.`);
            try {
              await whatsappService.notifyPhone(branchId, 
                `⚠️ *PEDIDO PERDIDO — ACCIÓN REQUERIDA*\n\nLa IA confirmó una venta en texto pero no registró el pedido.\n\n👤 *Cliente:* ${contact.name || 'Sin nombre'}\n📱 *WhatsApp:* ${contact.phone}\n\nTexto de la IA:\n"${(aiResult.response || '').substring(0, 300)}"`
              );
            } catch (notifErr) {
              logger.error('Error notificando admin en SAFETY-NET:', notifErr);
            }
          }
        }

        // SAFETY NET para Wompi: rescatar cierre de venta cuando la IA habla de link de pago sin [CERRAR_VENTA]
        if (impliesWompiClose) {
          logger.warn(`⚠️ [SAFETY-NET-WOMPI] IA habla de generar link de pago sin etiqueta [CERRAR_VENTA] — activando rescate. Texto: "${(aiResult.response || '').substring(0, 150)}"`);
          const aiFullTextW = aiResult.response || '';
          const wProductPatterns = [
            /[-•]\s*\*?([^*\n$]{5,60}?)\*?\s+por\s+\$/i,
            /pedido\s+del?\s+([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+por|\s+a\s|\s+en\s|\.|,|\n)/i,
            /([A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s]{3,40}[A-Z0-9]{2,6}[-][A-Z0-9]{2,10})/,
          ];
          let wRescuedProduct = null;
          for (const pat of wProductPatterns) {
            const m = aiFullTextW.match(pat);
            if (m && m[1]) { wRescuedProduct = m[1].trim().replace(/[*_]/g, ''); break; }
          }
          if (!wRescuedProduct) {
            const recentAIW = messageHistory.filter(m => m.role === 'ASSISTANT').slice(-5);
            for (const msgW of recentAIW.reverse()) {
              for (const pat of wProductPatterns) {
                const m = (msgW.content || '').match(pat);
                if (m && m[1]) { wRescuedProduct = m[1].trim().replace(/[*_]/g, ''); break; }
              }
              if (wRescuedProduct) break;
            }
          }
          if (!wRescuedProduct) {
            const saleInterest = conversation?.context?.sale?.interestProducts;
            if (saleInterest?.length) wRescuedProduct = saleInterest[saleInterest.length - 1];
          }
          if (wRescuedProduct) {
            logger.info(`✅ [SAFETY-NET-WOMPI] Producto rescatado: "${wRescuedProduct}" — activando shouldCloseSale (Wompi)`);
            actions.shouldCloseSale = true;
            actions.productsToSell = [wRescuedProduct];
          }
        }
      }

      // Actualizar cliente
      const contactUpdates = {};
      if (actions.capturedName || actions.capturedFullName) contactUpdates.name = actions.capturedFullName || actions.capturedName;
      if (actions.capturedCity) contactUpdates.city = actions.capturedCity;
      if (actions.capturedAddress) contactUpdates.address = actions.capturedAddress;
      if (actions.capturedNeighborhood) contactUpdates.neighborhood = actions.capturedNeighborhood;
      if (actions.capturedInterests) contactUpdates.interests = actions.capturedInterests;
      if (actions.capturedDeliveryPhone) contactUpdates.deliveryPhone = actions.capturedDeliveryPhone;

      // FALLBACK: Si la IA intentó cerrar contraentrega/venta pero no capturó la dirección con etiqueta,
      // intentar rescatar la dirección que la IA menciona en su propio texto de respuesta.
      if ((actions.shouldCreateContraEntrega || actions.shouldCloseSale) && !contactUpdates.address && !contact.address) {
        const aiText = aiResult.response || '';
        const addrInText = aiText.match(/(?:direcci[oó]n(?:\s+en)?|dirección\s+como|direcci[oó]n:\s*|enviar[^a]*a|enviando[^a]*a)\s*([A-Za-z0-9#\-\.° ,áéíóúÁÉÍÓÚñÑ]{8,80})/i);
        if (addrInText && addrInText[1]) {
          const rescued = addrInText[1].trim().replace(/[.,!?]+$/, '');
          logger.info(`🔍 [ADDR-RESCUE] Dirección rescatada del texto de IA: "${rescued}"`);
          contactUpdates.address = rescued;
        }
        const userAddrMatch = body.match(/(?:calle|carrera|avenida|diagonal|transversal|cl|kr|av|dg|tv)\s+[A-Za-z0-9#\-\.° ,áéíóúÁÉÍÓÚñÑ]{3,60}/i);
        if (!contactUpdates.address && userAddrMatch) {
          const rescued = userAddrMatch[0].trim();
          logger.info(`🔍 [ADDR-RESCUE] Dirección rescatada del mensaje del usuario: "${rescued}"`);
          contactUpdates.address = rescued;
        }
      }

      // FALLBACK: Si la IA mencionó una ciudad (Popayán, Pitalito, etc.) pero no usó [CAPTURAR_CIUDAD]
      if ((actions.shouldCreateContraEntrega || actions.shouldCloseSale) && !contactUpdates.city && !contact.city) {
        const ciudadesContraentrega = ['Popayán', 'Pitalito', 'Florencia', 'Yopal'];
        const bodyAndResponse = `${body} ${aiResult.response || ''}`;
        for (const ciudad of ciudadesContraentrega) {
          if (bodyAndResponse.toLowerCase().includes(ciudad.toLowerCase())) {
            logger.info(`🔍 [CITY-RESCUE] Ciudad rescatada del texto: "${ciudad}"`);
            contactUpdates.city = ciudad;
            break;
          }
        }
      }

      if (Object.keys(contactUpdates).length > 0) {
        await crmService.updateContactInfo(contact.id, contactUpdates);
        // Recargar contact para que los checks de dirección usen los datos frescos
        contact = await crmService.findOrCreateContact(chatId, branchId);
      }

      // ── Ficha de venta y clasificación ──
      const savedContext = await crmService.patchContext(conversation.id, (ctx) => {
        const merged = mergeSaleState(ctx.sale, actions, aiResult.flow);
        return merged ? { ...ctx, sale: merged } : null;
      });
      if (aiResult.classification) await crmService.updateClassification(contact.id, aiResult.classification);
      if (actions.objections?.length) {
        ownerAlertService.onSaleUpdate({ contact, conversation, branchId, actions, sale: savedContext?.sale || {} })
          .catch(err => logger.warn(`⚠️ [OWNER-ALERT] hesitation: ${err.message}`));
      }

      if (actions.productsToSell?.length) {
        await crmService.saveOrderDraft(conversation.id, {
          productos: actions.productsToSell,
          metodoPago: actions.shouldCreateContraEntrega ? 'contraentrega' : 'link de pago',
        });
      }

      // VALIDACIÓN DE DIRECCIÓN PREVIA AL ENVÍO DE RESPUESTA
      // Si la IA intenta cerrar venta/contraentrega pero falta dirección/ciudad,
      // suprimimos la respuesta generada de la IA para evitar confirmaciones falsas.
      const finalAddress = contactUpdates.address || contact.address;
      const finalCity = contactUpdates.city || contact.city;
      const missingAddress = !finalAddress || finalAddress === 'Por confirmar';
      const missingCity = !finalCity || finalCity === 'Por confirmar';

      let aiResponseToSend = aiResult.response;
      if ((actions.shouldCreateContraEntrega || actions.shouldCloseSale) && (missingAddress || missingCity)) {
        logger.warn(`⚠️ [MSG-BLOCKED] IA intentó cerrar venta pero falta dirección/ciudad. Suprimiendo respuesta contradictoria.`);
        aiResponseToSend = null;
      }

      logger.info(`📤 [MSG-DEBUG] aiResponseToSend: ${aiResponseToSend ? 'SÍ tiene respuesta' : 'NULL — sin respuesta'}, shouldContraEntrega=${actions.shouldCreateContraEntrega}, shouldCloseSale=${actions.shouldCloseSale}, missingAddress=${missingAddress}, missingCity=${missingCity}`);

      if (aiResponseToSend) {
        const responseParts = this.splitMessageNaturally(aiResponseToSend);
        
        logger.info(`📤 [MSG-SEND] Preparando envío de ${responseParts.length} partes a ${chatId} (branch ${branchId})`);
        for (let i = 0; i < responseParts.length; i++) {
          await whatsappService.sendMessage(branchId, chatId, responseParts[i]);
          if (i < responseParts.length - 1) {
            await new Promise(r => setTimeout(r, 1200));
          }
        }
        logger.info(`✅ [MSG-SEND] Envío completado para ${chatId}`);
        await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResponseToSend, null, aiResult.tokensUsed);
      } else {
        await crmService.saveMessage(conversation.id, 'ASSISTANT', '[Mensaje suprimido por validación de backend]', null, aiResult.tokensUsed);
      }

      // Imágenes (máximo 3 para no saturar el chat)
      if (actions.images?.length > 0) {
        for (const imgUrl of actions.images.slice(0, 3)) {
          const cleanUrl = imgUrl.replace(/^Media:\s*/i, '');
          if (cleanUrl?.startsWith('http')) await whatsappService.sendMedia(branchId, chatId, cleanUrl);
        }
      }

      // ── CONTRAENTREGA ──────────────────────────────────────
      if (actions.shouldCreateContraEntrega && actions.productsToSell?.length > 0) {
        if (missingAddress) {
          logger.warn(`⚠️ [CONTRAENTREGA] Sin dirección para ${chatId} — bloqueando pedido`);
          const msgDir = '📍 Para registrar tu pedido necesito tu dirección completa. ¿En qué dirección te lo enviamos? 🏠';
          await whatsappService.sendMessage(branchId, chatId, msgDir);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgDir);
          return;
        }
        
        if (missingCity) {
          logger.warn(`⚠️ [CONTRAENTREGA] Sin ciudad para ${chatId} — bloqueando pedido`);
          const msgCity = '🏙️ ¿En qué ciudad te encuentras? Necesito confirmar la ciudad antes de registrar tu pedido.';
          await whatsappService.sendMessage(branchId, chatId, msgCity);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgCity);
          return;
        }

        logger.info(`📦 [CONTRAENTREGA] Procesando pedido contraentrega para ${chatId}`);
        const resolved = await catalogService.resolveSaleProducts(actions.productsToSell, branchId);
        const { items: orderItems, productNames, notFound, totalAmount } = resolved;

        if (orderItems.length === 0) {
          logger.error(`⚠️ [CONTRAENTREGA] No se encontraron productos en BD para: ${actions.productsToSell.join(', ')}`);
          const fallbackMsg = '⚠️ Hubo un problema identificando los productos en nuestro sistema. Un asesor revisará tu pedido en breve para confirmarlo manualmente.';
          await whatsappService.sendMessage(branchId, chatId, fallbackMsg);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', fallbackMsg);
          
          const cleanPhoneAlert = (contact.phone || chatId).replace(/@[a-z.]+$/i, '');
          const nameLabelAlert = contact.name && contact.name !== 'Sin nombre' ? contact.name : `Cliente ${cleanPhoneAlert}`;
          await whatsappService.notifyPhone(branchId, `⚠️ *ALERTA DE PEDIDO (Contraentrega)*\nEl bot no encontró los productos en la BD:\nProductos: ${actions.productsToSell.join(', ')}\nCliente: ${nameLabelAlert} (${cleanPhoneAlert})`);

          return;
        }

        const duplicate = await crmService.findRecentSimilarOrder(contact.id, 'CONTRAENTREGA', orderItems.map(i => i.productId));
        if (duplicate) {
          logger.warn(`⚠️ [CONTRAENTREGA] Pedido #${duplicate.id} ya existe para este cliente. No se crea ni se avisa otra vez.`);
          return;
        }

        const codCity = contactUpdates.city || contact.city || 'Por confirmar';
        const codQuote = shippingService.quote(totalAmount, codCity);
        const order = await crmService.createOrder({
          contactId: contact.id,
          branchId,
          items: orderItems,
          amount: codQuote.total,
          shippingCity: codCity,
          shippingAddress: contactUpdates.address || contact.address || 'Por confirmar',
          status: 'PENDING',
          paymentMethod: 'CONTRAENTREGA',
          notes: [
            `${codQuote.label}: ${formatCOP(codQuote.fee)}`,
            notFound.length ? `No identificados: ${notFound.join(', ')}` : null,
          ].filter(Boolean).join(' | '),
        });

        // La IA ya informó al cliente que el pedido fue registrado: sin doble confirmación.
        logger.info(`✅ [CONTRAENTREGA] Pedido #${order.id} creado por ${formatCOP(codQuote.total)} (envío ${formatCOP(codQuote.fee)}) — sin doble confirmación al cliente.`);

        await crmService.recordPurchase(contact.id, codQuote.total, conversation.id);
        await crmService.patchContext(conversation.id, (ctx) => {
          const next = { ...ctx };
          delete next.pedido;
          next.sale = {
            ...(ctx.sale || {}),
            stage: 'comprado',
            lastPurchase: { orderId: order.id, products: productNames, amount: codQuote.total, at: new Date().toISOString() },
            updatedAt: new Date().toISOString(),
          };
          return next;
        });
        await postSaleService.schedule(order.id);

        // Notificar al número central
        const cleanClientPhone = (contact.phone || chatId).replace(/@[a-z.]+$/i, '');
        const clientName = contact.name && contact.name !== 'Sin nombre' ? contact.name : `Cliente ${cleanClientPhone}`;
        const deliveryPhone = contactUpdates.deliveryPhone || contact.deliveryPhone || 'No proporcionado';
        const finalAddr = contactUpdates.address || contact.address;
        const finalCityCOD = contactUpdates.city || contact.city;
        const hasAddr = finalAddr && finalAddr !== 'Por confirmar';
        const hasCity = finalCityCOD && finalCityCOD !== 'Por confirmar';
        const addrWarning = (!hasAddr || !hasCity)
          ? `\n⚠️ *DIRECCIÓN PENDIENTE — CONTACTAR AL CLIENTE*\n`
          : '';
        const waLink = ownerAlertService.waLink(cleanClientPhone);
        const historyLine = await ownerAlertService.buyerHistoryLine(contact.id);
        const centralMsg = `📦 *PEDIDO CONTRAENTREGA* 📦\n\n` +
          `🧾 *Pedido:* #${order.id}\n` +
          `👤 *Cliente:* ${clientName}\n` +
          `📱 *WhatsApp:* ${cleanClientPhone}\n` +
          `${waLink ? `💬 *Abrir chat:* ${waLink}\n` : ''}` +
          `${historyLine ? `${historyLine}\n` : ''}` +
          `📞 *Teléfono para entrega:* ${deliveryPhone}\n` +
          `📦 *Productos:* ${productNames.join(', ')}\n` +
          `${notFound.length ? `⚠️ *Sin identificar:* ${notFound.join(', ')}\n` : ''}` +
          `${shippingService.breakdownLines(codQuote)}\n` +
          `💵 *Cobrar al entregar:* ${formatCOP(codQuote.total)}\n\n` +
          `📍 *DIRECCIÓN DE ENTREGA:*\n` +
          `${hasAddr ? finalAddr : '❌ NO PROPORCIONADA — CONTACTAR AL CLIENTE'}\n` +
          `🏙️ *CIUDAD:* ${hasCity ? finalCityCOD : '❌ NO PROPORCIONADA — CONTACTAR AL CLIENTE'}\n` +
          `${contactUpdates.neighborhood || contact.neighborhood ? `🏘️ *Barrio:* ${contactUpdates.neighborhood || contact.neighborhood}\n` : ''}` +
          `${addrWarning}` +
          `\n⚠️ *TIPO:* Contraentrega (pago en efectivo al recibir)`;

        const sent = await whatsappService.notifyPhone(branchId, centralMsg);
        await crmService.markOwnerNotified(order.id, !!sent);
      }

      // Cierre de venta Wompi
      if (actions.shouldCloseSale && actions.productsToSell?.length > 0) {
        if (missingAddress) {
          logger.warn(`⚠️ [WOMPI] Sin dirección para ${chatId} — bloqueando link de pago`);
          const msgDir = '📍 Para generar tu link de pago necesito tu dirección completa. ¿En qué dirección te lo enviamos? 🏠';
          await whatsappService.sendMessage(branchId, chatId, msgDir);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgDir);
          return;
        }
        
        if (missingCity) {
          logger.warn(`⚠️ [WOMPI] Sin ciudad para ${chatId} — bloqueando link de pago`);
          const msgCity = '🏙️ ¿En qué ciudad te encuentras? Necesito confirmar la ciudad antes de generar el link de pago.';
          await whatsappService.sendMessage(branchId, chatId, msgCity);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgCity);
          return;
        }

        logger.info(`💰 [SALE] Iniciando proceso de pago para ${chatId}`);
        const resolved = await catalogService.resolveSaleProducts(actions.productsToSell, branchId);
        const { items: orderItems, productNames, notFound, totalAmount } = resolved;

        if (orderItems.length === 0) {
          logger.error(`⚠️ [WOMPI] No se encontraron productos en BD para: ${actions.productsToSell.join(', ')}`);
          const fallbackMsg = '⚠️ Hubo un problema identificando los productos en nuestro sistema. Un asesor revisará tu pedido en breve para generar el link de pago manualmente.';
          await whatsappService.sendMessage(branchId, chatId, fallbackMsg);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', fallbackMsg);
          
          await whatsappService.notifyPhone(branchId, `⚠️ *ALERTA DE PEDIDO (Wompi)*\nEl bot no encontró los productos en la BD:\nProductos: ${actions.productsToSell.join(', ')}\nCliente: ${contact.name} (${contact.phone})`);
          return;
        }

        const pending = conversation?.context?.sale?.pendingPayment;
        const pendingNames = (pending?.products || []).map(name => String(name).toLowerCase());
        const samePending = pending?.sentAt
          && (Date.now() - new Date(pending.sentAt).getTime() < 30 * 60 * 1000)
          && productNames.length > 0
          && productNames.every(name => pendingNames.includes(String(name).toLowerCase()));
        if (samePending) {
          logger.warn(`💰 [SALE] Link ${pending.reference} ya se envió hace poco. No se genera otro.`);
          return;
        }

        const payCity = contactUpdates.city || contact.city || 'Por confirmar';
        const payQuote = shippingService.quote(totalAmount, payCity);
        const cartData = {
          contactId: contact.id,
          branchId,
          items: orderItems,
          amount: payQuote.total,
          shippingCity: payCity,
          shippingAddress: contactUpdates.address || contact.address || 'Por confirmar',
          notes: [
            `${payQuote.label}: ${formatCOP(payQuote.fee)}`,
            notFound.length ? `No identificados: ${notFound.join(', ')}` : null,
          ].filter(Boolean).join(' | '),
        };

        const wompiLink = await this.sendPaymentLink({ conversationId: conversation.id, contact, chatId, branchId, cartData, productNames });
        if (!wompiLink) {
          const errorMsg = "Lo siento, tuve un pequeño problema técnico generando tu link de pago seguro. 😅 Dame un momento y ya te conecto con un compañero para que te ayude de inmediato.";
          await whatsappService.sendMessage(branchId, chatId, errorMsg);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', errorMsg);
        }
      }

      if (actions.shouldEscalate) {
        await crmService.escalateConversation(conversation.id);
        ownerAlertService.onEscalation({ contact, conversation, branchId, body, messageHistory })
          .catch(err => logger.warn(`⚠️ [OWNER-ALERT] escalation: ${err.message}`));
      }
  }

  /**
   * Genera un link Wompi para un carrito, lo guarda en el contexto y lo envía.
   * Reutilizado por los seguimientos para reenviar links vencidos.
   */
  async sendPaymentLink({ conversationId, contact, chatId, branchId, cartData, productNames, intro = null }) {
    const reference = `PAY-${conversationId}-${Date.now()}`;

    await crmService.patchContext(conversationId, (ctx) => ({
      ...ctx,
      pendingCarts: { ...(ctx.pendingCarts || {}), [reference]: cartData },
    }));

    try {
      const wompiLink = await wompiService.generatePaymentLink({
        branchId,
        amount: cartData.amount,
        name: `Pedido - ${contact.name || 'Cliente'}`,
        description: `Compra: ${productNames.join(', ')}`,
        reference
      });
      if (!wompiLink?.url) return null;

      // Las transacciones de links de pago llegan con una referencia propia de Wompi:
      // el webhook solo puede reconocer la venta por payment_link_id.
      await crmService.patchContext(conversationId, (ctx) => {
        const carts = { ...(ctx.pendingCarts || {}) };
        if (!carts[reference]) return null;
        carts[reference] = { ...carts[reference], paymentLinkId: wompiLink.id };
        return { ...ctx, pendingCarts: carts };
      });

      const subtotal = (cartData.items || []).reduce((sum, i) => sum + Number(i.price) * (i.quantity || 1), 0);
      const fee = Number(cartData.amount) - subtotal;
      const breakdown = fee > 0
        ? `${shippingService.breakdownLines({ subtotal, fee, label: shippingService.getShipping(cartData.shippingCity).label, total: Number(cartData.amount) })}\n\n`
        : '';
      const paymentMsg = intro
        ? `${intro}\n\n🔗 ${wompiLink.url}`
        : `✨ *¡Todo listo!* Aquí tienes tu link de pago seguro por *$${Number(cartData.amount).toLocaleString('es-CO')} COP*${fee > 0 ? ' (envío incluido)' : ''}:\n\n${breakdown}🔗 ${wompiLink.url}\n\nConfírmame cuando lo realices para despachar tu pedido discreto. 🌹`;
      await whatsappService.sendMessage(branchId, chatId, paymentMsg);
      await crmService.saveMessage(conversationId, 'ASSISTANT', paymentMsg);

      await crmService.setSaleStage(conversationId, 'link_enviado', {
        pendingPayment: { reference, paymentLinkId: wompiLink.id, amount: cartData.amount, products: productNames, sentAt: new Date().toISOString() },
      });
      return wompiLink;
    } catch (err) {
      logger.error(`❌ [SALE-ERR] Wompi falló: ${err.message}`);
      return null;
    }
  }

  _isMessageBlocked(chatId, msg) {
    return (
      this._isPhoneBlocked(chatId) ||
      this._isPhoneBlocked(msg?.from) ||
      this._isPhoneBlocked(msg?.author) ||
      this._isPhoneBlocked(msg?._data?.from) ||
      this._isPhoneBlocked(msg?._data?.author)
    );
  }

  /**
   * Verifica si un JID, número o string pertenece a un número bloqueado.
   * Maneja sufijos de dispositivo (:45), dominios (@c.us) y prefijo de país (57).
   */
  _isPhoneBlocked(rawPhoneOrJid) {
    if (!rawPhoneOrJid) return false;
    const BLOCKED_NUMBERS = ['3106124802'];
    
    const rawStr = String(rawPhoneOrJid);
    const beforeDomain = rawStr.split('@')[0];
    const beforeDevice = beforeDomain.split(':')[0];
    const digitsOnly = beforeDevice.replace(/\D/g, '');

    return BLOCKED_NUMBERS.some(blocked => {
      const bDigits = String(blocked).replace(/\D/g, '');
      if (!bDigits) return false;
      return (
        digitsOnly === bDigits ||
        digitsOnly === '57' + bDigits ||
        (bDigits.length >= 10 && digitsOnly.endsWith(bDigits)) ||
        rawStr.includes(bDigits)
      );
    });
  }

  /**
   * Si la IA cierra por contraentrega y por link en el mismo turno, queda un solo camino:
   * el medio de pago que el cliente mencionó de último.
   */
  _preferClientPaymentMethod(actions, body, messageHistory = []) {
    if (!actions.shouldCreateContraEntrega || !actions.shouldCloseSale) return;

    const blob = [...messageHistory.filter(m => m.role === 'USER').slice(-6).map(m => m.content || ''), body || '']
      .join('\n')
      .toLowerCase();
    const lastIndex = (words) => words.reduce((max, word) => Math.max(max, blob.lastIndexOf(word)), -1);
    const electronicAt = lastIndex(['nequi', 'daviplata', 'davi plata', 'transferenc', 'tarjeta', 'wompi', 'pse', 'link de pago']);
    const cashAt = lastIndex(['contraentrega', 'contra entrega', 'efectivo', 'pago al recibir']);
    const useElectronic = electronicAt > cashAt;

    if (useElectronic) {
      actions.shouldCreateContraEntrega = false;
      if (actions.wompiProducts?.length) actions.productsToSell = actions.wompiProducts;
      logger.warn('⚠️ [SALE] Salieron las dos etiquetas de cierre. Se usa el link de pago que pidió el cliente.');
    } else {
      actions.shouldCloseSale = false;
      if (actions.contraProducts?.length) actions.productsToSell = actions.contraProducts;
      logger.warn('⚠️ [SALE] Salieron las dos etiquetas de cierre. Se usa contraentrega.');
    }
  }

  /**
   * Divide un mensaje largo en partes naturales, cortando por párrafo (\n\n)
   * sin cortar palabras ni frases. Mensajes cortos se dejan como están.
   */
  splitMessageNaturally(text) {
    if (!text || text.length < 120) return [text];
    
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    if (paragraphs.length <= 1) return [text];
    
    // Agrupar párrafos muy cortos con el anterior para no enviar líneas huérfanas
    const parts = [];
    let current = '';
    
    for (const para of paragraphs) {
      if (current && (current.length + para.length) < 150) {
        current += '\n\n' + para;
      } else if (!current) {
        current = para;
      } else {
        parts.push(current);
        current = para;
      }
    }
    if (current) parts.push(current);
    
    if (parts.length <= 1) return [text];
    
    return parts;
  }
}

module.exports = new MessageController();

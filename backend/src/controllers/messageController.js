// ─────────────────────────────────────────────────────────
//  CONTROLLER: Mensajes WhatsApp — Flujo principal
// ─────────────────────────────────────────────────────────
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const wompiService = require('../services/wompiService');
const catalogService = require('../services/catalogService');
const { prisma } = require('../config/database');
const { isWorkingHours } = require('../utils/helpers');

class MessageController {
  constructor() {
    this.processedMessages = new Set();
    // Mutex por chat: evita que dos mensajes del mismo chat se procesen simultáneamente
    this.processingChats = new Set();
    // Marca de tiempo de arranque: ignorar mensajes viejos que llegan en ráfaga al reconectar
    this.bootTime = Date.now();
  }

  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = (msg.body || '').trim();
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    try {
      if (!chatId || chatId === 'status@broadcast' || chatId.includes('@g.us') || msg.fromMe || (!body && !msg.hasMedia)) return;

      // Procesar todos los mensajes sin importar la antigüedad para asegurar 100% de atención
      // El antiBanDelay se encarga de que las respuestas salgan a un ritmo seguro
      const msgTimestamp = msg.timestamp ? msg.timestamp * 1000 : Date.now();
      logger.info(`📩 [MSG-IN] Procesando mensaje de ${chatId} (Timestamp: ${new Date(msgTimestamp).toLocaleString()})`);

      if (this.processedMessages.has(msgId)) return;
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 60000);

      // Mutex por chat: si ya estamos procesando un mensaje de este chat, ignorar el duplicado
      if (this.processingChats.has(chatId)) {
        logger.info(`🔒 [SKIP-DUP] Ya se está procesando un mensaje de ${chatId}, ignorando duplicado.`);
        return;
      }
      this.processingChats.add(chatId);

      logger.info(`📨 [MSG-IN] ${chatId}: "${body.substring(0, 30)}..."`);

      // ── 1. ¿ES EMPLEADO? ────────────────────────────────────
      const cleanPhone = chatId.split('@')[0];
      const employee = await prisma.employeeAccess.findFirst({
        where: { phone: cleanPhone }
      });

      if (employee) {
        logger.info(`👷 [EMPLOYEE] Mensaje de ${employee.name} (${chatId})`);
        const employeeResponse = await aiService.generateEmployeeResponse(body, branchId);
        await whatsappService.sendMessage(branchId, chatId, employeeResponse.response);
        return;
      }

      // ── 2. CRM Y CONVERSACIÓN ────────────────────────────────
      const contact = await crmService.findOrCreateContact(chatId, branchId);
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // ── 3. VERIFICAR HORARIO LABORAL ────────────────────────
      const workingStatus = isWorkingHours();
      if (!workingStatus.isWorking) {
        logger.info(`🌙 [OFF-HOURS] Mensaje recibido de ${chatId} (Razón: ${workingStatus.reason}). Guardando para mañana.`);
        
        // Marcar conversación como pendiente de respuesta offline
        const currentContext = conversation.context || {};
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { context: { ...currentContext, pendingOfflineReply: true } }
        });

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
          // Continuar el flujo normal en vez de hacer return
        } else {
          logger.info(`🤫 [MSG] Chat pausado/escalado para ${chatId} (${Math.round(minutesSinceLastResponse)}min). Esperando humano.`);
          await crmService.saveMessage(conversation.id, 'USER', body);
          return;
        }
      }

      let mediaData = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.mimetype.startsWith('image/')) {
            mediaData = {
              data: media.data,
              mimetype: media.mimetype
            };
            logger.info(`📸 [MEDIA] Imagen recibida de ${chatId} (${media.mimetype})`);
          }
        } catch (mediaError) {
          logger.error(`❌ Error descargando media de ${chatId}:`, mediaError);
        }
      }

      if (!body && !mediaData) return; // Si no hay texto ni imagen, no procesar

      await crmService.saveMessage(conversation.id, 'USER', body || "[Imagen]");
      const messageHistory = conversation.messages || [];

      const aiResult = await aiService.generateResponse(body, contact, messageHistory, branchId, false, mediaData);
      
      if (!aiResult?.response) {
        logger.warn(`⚠️ [MSG] IA no generó texto para ${chatId}`);
        return;
      }

      // Separar mensaje largo en 2 envíos naturales (por párrafo, sin cortar palabras)
      const responseParts = this.splitMessageNaturally(aiResult.response);
      
      for (let i = 0; i < responseParts.length; i++) {
        await whatsappService.sendMessage(branchId, chatId, responseParts[i]);
        // Pequeña pausa entre mensajes para simular escritura humana
        if (i < responseParts.length - 1) {
          await new Promise(r => setTimeout(r, 1200));
        }
      }
      await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);

      const actions = aiResult.actions || {};
      
      // Actualizar cliente
      const contactUpdates = {};
      if (actions.capturedName || actions.capturedFullName) contactUpdates.name = actions.capturedFullName || actions.capturedName;
      if (actions.capturedCity) contactUpdates.city = actions.capturedCity;
      if (actions.capturedAddress) contactUpdates.address = actions.capturedAddress;
      if (actions.capturedNeighborhood) contactUpdates.neighborhood = actions.capturedNeighborhood;
      if (actions.capturedInterests) contactUpdates.interests = actions.capturedInterests;

      if (Object.keys(contactUpdates).length > 0) {
        await crmService.updateContactInfo(contact.id, contactUpdates);
      }

      // Clasificación
      if (actions.classification) await crmService.updateClassification(contact.id, actions.classification);

      // Imágenes
      if (actions.images?.length > 0) {
        for (const imgUrl of actions.images) {
          if (imgUrl?.startsWith('http')) await whatsappService.sendMedia(branchId, chatId, imgUrl);
        }
      }

      // Cierre de venta
      if (actions.shouldCloseSale && actions.productsToSell?.length > 0) {
        logger.info(`💰 [SALE] Iniciando proceso de pago para ${chatId}`);
        const orderItems = [];
        let totalAmount = 0;
        const productNames = [];

        for (const pName of actions.productsToSell) {
          const product = await catalogService.findProductByName(pName, branchId);
          if (product) {
            orderItems.push({ productId: product.id, quantity: 1, price: product.price });
            totalAmount += parseFloat(product.price);
            productNames.push(product.name);
          }
        }

        if (orderItems.length > 0) {
          const reference = `PAY-${conversation.id}-${Date.now()}`;
          const cartData = {
            contactId: contact.id,
            branchId,
            items: orderItems,
            amount: totalAmount,
            shippingCity: contactUpdates.city || contact.city || 'Por confirmar',
            shippingAddress: contactUpdates.address || contact.address || 'Por confirmar'
          };

          // Guardar carrito pendiente en el contexto de la conversación
          const currentContext = conversation.context || {};
          const pendingCarts = currentContext.pendingCarts || {};
          pendingCarts[reference] = cartData;

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { context: { ...currentContext, pendingCarts } }
          });

          try {
            const wompiLink = await wompiService.generatePaymentLink({
              branchId,
              amount: totalAmount,
              name: `Pedido - ${contact.name || 'Cliente'}`,
              description: `Compra: ${productNames.join(', ')}`,
              reference
            });

            if (wompiLink?.url) {
              const paymentMsg = `✨ *¡Todo listo!* Aquí tienes tu link de pago seguro por *$${totalAmount.toLocaleString('es-CO')} COP*:\n\n🔗 ${wompiLink.url}\n\nConfírmame cuando lo realices para despachar tu pedido discreto. 🌹`;
              await whatsappService.sendMessage(branchId, chatId, paymentMsg);
              await crmService.saveMessage(conversation.id, 'ASSISTANT', paymentMsg);
            }
          } catch (err) {
            logger.error(`❌ [SALE-ERR] Wompi falló: ${err.message}`);
            const errorMsg = "Lo siento, tuve un pequeño problema técnico generando tu link de pago seguro. 😅 Dame un momento y ya te conecto con un compañero para que te ayude de inmediato.";
            await whatsappService.sendMessage(branchId, chatId, errorMsg);
            await crmService.saveMessage(conversation.id, 'ASSISTANT', errorMsg);
          }
        }
      }

      if (actions.shouldEscalate) await crmService.escalateConversation(conversation.id);

    } catch (error) {
      logger.error(`❌ [CRITICAL-ERR] ${chatId}: ${error.stack}`);
      whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Ya te conecto con un compañero! 😊').catch(() => {});
    } finally {
      // Siempre liberar el mutex del chat para permitir el siguiente mensaje
      this.processingChats.delete(chatId);
    }
  }
  /**
   * Divide un mensaje largo en 2 partes naturales, cortando por párrafo (\n\n)
   * sin cortar palabras ni frases. Mensajes cortos se dejan como están.
   */
  splitMessageNaturally(text) {
    // Si el mensaje es corto, no dividir
    if (!text || text.length < 120) return [text];
    
    // Separar por párrafos (doble salto de línea)
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    
    // Si solo hay un párrafo o no se pudo dividir
    if (paragraphs.length <= 1) return [text];
    
    // Agrupar párrafos muy cortos con el anterior para no enviar líneas huérfanas
    const parts = [];
    let current = '';
    
    for (const para of paragraphs) {
      if (current && (current.length + para.length) < 150) {
        // Juntar con el anterior si ambos son cortos
        current += '\n\n' + para;
      } else if (!current) {
        current = para;
      } else {
        parts.push(current);
        current = para;
      }
    }
    if (current) parts.push(current);
    
    // Si todo quedó en una sola parte, devolver como está
    if (parts.length <= 1) return [text];
    
    return parts;
  }
}

module.exports = new MessageController();

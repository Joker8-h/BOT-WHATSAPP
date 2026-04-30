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
  }

  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = (msg.body || '').trim();
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    try {
      if (!chatId || chatId === 'status@broadcast' || chatId.includes('@g.us') || msg.fromMe || !body) return;

      if (this.processedMessages.has(msgId)) return;
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 60000);

      logger.info(`📨 [MSG-IN] ${chatId}: "${body.substring(0, 30)}..."`);

      // ── 1. ¿ES EMPLEADO? ────────────────────────────────────
      const cleanPhone = chatId.split('@')[0];
      const employee = await prisma.employeeAccess.findFirst({
        where: { phone: cleanPhone }
      });

      if (employee) {
        logger.info(`👷 [EMPLOYEE] Mensaje de ${employee.name} (${chatId})`);
        const allProducts = await catalogService.getAllProducts(branchId);
        const employeeResponse = await aiService.generateEmployeeResponse(body, allProducts);
        await whatsappService.sendMessage(branchId, chatId, employeeResponse);
        return;
      }

      // ── 2. CRM Y CONVERSACIÓN ────────────────────────────────
      const contact = await crmService.findOrCreateContact(chatId, branchId);
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // ── 3. VERIFICAR HORARIO LABORAL ────────────────────────
      if (!isWorkingHours()) {
        logger.info(`🌙 [OFF-HOURS] Mensaje recibido fuera de horario de ${chatId}`);
        
        // Marcar conversación como pendiente de respuesta offline
        const currentContext = conversation.context || {};
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { context: { ...currentContext, pendingOfflineReply: true } }
        });

        // Solo enviar el mensaje de fuera de horario una vez cada 24h por cliente
        // para no ser molestos si siguen escribiendo
        const lastMsg = conversation.messages[conversation.messages.length - 1];
        const isRecentOutOffice = lastMsg?.role === 'ASSISTANT' && lastMsg?.content.includes('nuestro equipo está descansando');

        if (!isRecentOutOffice) {
          const offHoursMsg = "¡Hola! Qué rico saludarte. 🌹 Te cuento que en este momento nuestro equipo está descansando para recargar energías. \n\nNuestro horario de atención es de *Lunes a Sábado de 9:00 AM a 6:00 PM*. \n\n¡Mañana mismo a primera hora te responderé personalmente con todo el amor! ✨ Mientras tanto, puedes contarnos qué te interesa y te dejaré agendado.";
          await whatsappService.sendMessage(branchId, chatId, offHoursMsg);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', offHoursMsg);
        } else {
          // Solo guardar el mensaje del usuario sin responder (ya lo guardamos arriba antes del if, pero por seguridad lo dejamos claro)
        }
        return;
      }

      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        logger.info(`🤫 [MSG] Chat pausado/escalado para ${chatId}`);
        await crmService.saveMessage(conversation.id, 'USER', body);
        return;
      }

      await crmService.saveMessage(conversation.id, 'USER', body);
      const messageHistory = conversation.messages || [];

      const aiResult = await aiService.generateResponse(body, contact, messageHistory, branchId, false);
      
      if (!aiResult?.response) {
        logger.warn(`⚠️ [MSG] IA no generó texto para ${chatId}`);
        return;
      }

      // Enviar respuesta principal
      await whatsappService.sendMessage(branchId, chatId, aiResult.response);
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
    }
  }
}

module.exports = new MessageController();

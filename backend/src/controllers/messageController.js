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

      const contact = await crmService.findOrCreateContact(chatId, branchId);
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

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
          const order = await crmService.createOrder({
            contactId: contact.id,
            branchId,
            items: orderItems,
            amount: totalAmount,
            shippingCity: contactUpdates.city || contact.city || 'Por confirmar',
            shippingAddress: contactUpdates.address || contact.address || 'Por confirmar'
          });

          try {
            const wompiLink = await wompiService.generatePaymentLink({
              branchId,
              amount: totalAmount,
              name: `Pedido - ${contact.name || 'Cliente'}`,
              description: `Compra: ${productNames.join(', ')}`,
              reference: `ORDER-${order.id}`
            });

            if (wompiLink?.url) {
              const paymentMsg = `✨ *¡Todo listo!* Aquí tienes tu link de pago seguro por *$${totalAmount.toLocaleString('es-CO')} COP*:\n\n🔗 ${wompiLink.url}\n\nConfírmame cuando lo realices para despachar tu pedido discreto. 🌹`;
              await whatsappService.sendMessage(branchId, chatId, paymentMsg);
              await crmService.saveMessage(conversation.id, 'ASSISTANT', paymentMsg);
              await prisma.order.update({
                where: { id: order.id },
                data: { wompiPaymentLink: wompiLink.url, wompiTransactionId: wompiLink.id }
              });
            }
          } catch (err) {
            logger.error(`❌ [SALE-ERR] Wompi falló: ${err.message}`);
          }
        }
      }

      if (actions.shouldEscalate) await crmService.escalateConversation(conversation.id);

    } catch (error) {
      logger.error(`❌ [CRITICAL-ERR] ${chatId}: ${error.stack}`);
      whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Enseguida te atiendo! 😊').catch(() => {});
    }
  }
}

module.exports = new MessageController();

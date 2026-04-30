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
    // Deduplicación: evitar procesar el mismo mensaje 2 veces (replay al conectar)
    this.processedMessages = new Set();
  }

  /**
   * Procesa un mensaje entrante de WhatsApp
   */
  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = (msg.body || '').trim();
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    try {
      // ── 0. FILTROS PRIMARIOS ────────────────────────────────
      if (!chatId || chatId === 'status@broadcast' || chatId.includes('@g.us') || msg.fromMe || !body) return;

      // ── 1. DEDUPLICACIÓN ────────────────────────────────────
      if (this.processedMessages.has(msgId)) return;
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 60000);

      logger.info(`📨 [MSG] De ${chatId}: "${body.substring(0, 60)}"`);

      // ── 2. CRM: Contacto y Conversación ────────────────────
      const contact = await crmService.findOrCreateContact(chatId, branchId);
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        await crmService.saveMessage(conversation.id, 'USER', body);
        return;
      }

      // ── 3. Guardar mensaje y llamar IA ─────────────────────
      await crmService.saveMessage(conversation.id, 'USER', body);
      const messageHistory = conversation.messages || [];

      logger.info(`🤖 [MSG] Generando respuesta IA...`);
      const aiResult = await aiService.generateResponse(body, contact, messageHistory, branchId, false);

      if (!aiResult?.response) return;

      // ── 4. Enviar respuesta principal ─────────────────────
      await whatsappService.sendMessage(branchId, chatId, aiResult.response);
      await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);

      // ── 5. Procesar acciones capturadas ───────────────────
      const actions = aiResult.actions || {};

      // A. Actualizar datos del cliente
      const contactUpdates = {};
      if (actions.capturedName || actions.capturedFullName) contactUpdates.name = actions.capturedFullName || actions.capturedName;
      if (actions.capturedCity) contactUpdates.city = actions.capturedCity;
      if (actions.capturedAddress) contactUpdates.address = actions.capturedAddress;
      if (actions.capturedNeighborhood) contactUpdates.neighborhood = actions.capturedNeighborhood;
      if (actions.capturedInterests) contactUpdates.interests = actions.capturedInterests;

      if (Object.keys(contactUpdates).length > 0) {
        await crmService.updateContactInfo(contact.id, contactUpdates);
      }

      // B. Clasificación
      if (actions.classification) await crmService.updateClassification(contact.id, actions.classification);

      // C. Imágenes
      if (actions.images?.length > 0) {
        for (const imgUrl of actions.images) {
          if (imgUrl?.startsWith('http')) await whatsappService.sendMedia(branchId, chatId, imgUrl);
        }
      }

      // D. CIERRE DE VENTA (Link de Pago)
      if (actions.shouldCloseSale && actions.productsToSell?.length > 0) {
        logger.info(`💰 [SALE] Iniciando generación de link de pago para ${chatId}`);
        
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
          // Crear orden
          const order = await crmService.createOrder({
            contactId: contact.id,
            branchId,
            items: orderItems,
            amount: totalAmount,
            shippingCity: contactUpdates.city || contact.city || 'Por confirmar',
            shippingAddress: contactUpdates.address || contact.address || 'Por confirmar'
          });

          // Generar link en Wompi
          try {
            const wompiLink = await wompiService.generatePaymentLink({
              branchId,
              amount: totalAmount,
              name: `Pedido Fantasías - ${contact.name || 'Cliente'}`,
              description: `Compra de: ${productNames.join(', ')}`,
              reference: `ORDER-${order.id}-${Date.now()}`
            });

            if (wompiLink?.url) {
              const paymentMsg = `✨ *¡Todo listo!* Aquí tienes tu link de pago seguro para completar tu pedido de ${productNames.join(' y ')} por un total de *$${totalAmount.toLocaleString('es-CO')} COP*:\n\n🔗 ${wompiLink.url}\n\nTan pronto realices el pago, me llegará la notificación y procederemos con tu envío 100% discreto. 🌹`;
              await whatsappService.sendMessage(branchId, chatId, paymentMsg);
              
              // Guardar mensaje del link
              await crmService.saveMessage(conversation.id, 'ASSISTANT', paymentMsg);
              
              // Actualizar orden con el link
              await prisma.order.update({
                where: { id: order.id },
                data: { wompiPaymentLink: wompiLink.url, wompiTransactionId: wompiLink.id }
              });
            }
          } catch (wompiErr) {
            logger.error(`❌ [SALE] Error generando link de Wompi:`, wompiErr.message);
            await whatsappService.sendMessage(branchId, chatId, "Tuve un pequeño problema técnico generando tu link de pago. 😅 Dame un segundo y ya te lo envío, o un asesor humano te ayudará.");
          }
        }
      }

      // E. Escalamiento
      if (actions.shouldEscalate) await crmService.escalateConversation(conversation.id);

    } catch (error) {
      logger.error(`❌ [MSG] Error para ${chatId}:`, error.message);
      whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Enseguida te atiendo! 😊').catch(() => {});
    }
  }
}

module.exports = new MessageController();

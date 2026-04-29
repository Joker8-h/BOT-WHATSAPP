const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');

class MessageController {
  /**
   * Procesa un mensaje entrante de WhatsApp
   */
  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = msg.body || '';

    try {
      // 1. IGNORAR ESTADOS Y GRUPOS
      if (chatId === 'status@broadcast' || chatId.includes('@g.us')) {
        return;
      }

      if (!body.trim()) return;

      logger.info(`🔍 [MSG] De ${chatId}: "${body.substring(0, 50)}..."`);

      // 2. Identificar cliente (findOrCreateContact es el nombre real en crmService)
      const contact = await crmService.findOrCreateContact(chatId, branchId);
      logger.info(`👤 [MSG] Cliente: ${contact.name || 'Nuevo'}`);

      // 3. Obtener conversación activa (getActiveConversation es el nombre real)
      const conversation = await crmService.getActiveConversation(contact.id, branchId);
      logger.info(`💬 [MSG] Conversación: ${conversation.id}`);

      // Si está en modo humano, solo guardar
      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        logger.info(`🤫 [MSG] Modo humano activo. Solo guardando.`);
        await crmService.saveMessage(conversation.id, 'USER', body);
        return;
      }

      // 4. Historial (conversation.messages ya viene incluido de getActiveConversation)
      const messageHistory = conversation.messages || [];
      logger.info(`📚 [MSG] Historial: ${messageHistory.length} mensajes`);

      // 5. Guardar mensaje del usuario
      await crmService.saveMessage(conversation.id, 'USER', body);

      // 6. Generar respuesta con IA
      // FIRMA REAL: generateResponse(userMessage, contact, messageHistory, branchId, hasRecentHumanIntervention)
      logger.info(`🤖 [MSG] Llamando a IA...`);
      const aiResult = await aiService.generateResponse(
        body,           // userMessage
        contact,        // contact (objeto completo del CRM)
        messageHistory, // messageHistory (array de mensajes)
        branchId,       // branchId
        false           // hasRecentHumanIntervention
      );

      if (!aiResult || !aiResult.response) {
        logger.warn(`⚠️ [MSG] IA no generó respuesta`);
        return;
      }
      logger.info(`✨ [MSG] IA respondió (${aiResult.tokensUsed} tokens)`);

      // 7. Enviar respuesta
      await whatsappService.sendMessage(branchId, chatId, aiResult.response);
      logger.info(`📤 [MSG] Enviado a ${chatId}`);

      // 8. Guardar respuesta IA
      await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);

      // 9. Enviar imágenes si la IA las sugiere
      if (aiResult.actions?.images?.length > 0) {
        for (const imgUrl of aiResult.actions.images) {
          await whatsappService.sendMedia(branchId, chatId, imgUrl);
        }
      }

      // 10. Actualizar clasificación si aplica
      if (aiResult.actions?.classification) {
        await crmService.updateClassification(contact.id, aiResult.actions.classification);
      }

    } catch (error) {
      logger.error(`❌ [MSG] Error para ${chatId}:`, error);
      try {
        await whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Un placer saludarte! ✨');
      } catch (e) {}
    }
  }
}

module.exports = new MessageController();

const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');

class MessageController {
  /**
   * Procesa un mensaje entrante de WhatsApp
   * @param {object} msg - Objeto mensaje original de whatsapp-web.js
   * @param {number} branchIdStr - ID de la sucursal
   */
  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = msg.body || '';

    try {
      // 1. IGNORAR ESTADOS Y GRUPOS
      if (chatId === 'status@broadcast' || chatId.includes('@g.us')) return;
      if (!body.trim()) return;

      logger.info(`🔍 [MSG] De ${chatId}: "${body.substring(0, 50)}"`);

      // 2. Identificar cliente
      const contact = await crmService.findOrCreateContact(chatId, branchId);
      logger.info(`👤 [MSG] Cliente: ${contact.name || 'Nuevo'}`);

      // 3. Obtener conversación activa
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // Si está en modo humano, solo guardar
      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        await crmService.saveMessage(conversation.id, 'USER', body);
        return;
      }

      // 4. Historial
      const messageHistory = conversation.messages || [];

      // 5. Guardar mensaje del usuario
      await crmService.saveMessage(conversation.id, 'USER', body);

      // 6. Generar respuesta con IA
      logger.info(`🤖 [MSG] Llamando a IA...`);
      const aiResult = await aiService.generateResponse(
        body,           // userMessage
        contact,        // contact
        messageHistory, // messageHistory
        branchId,       // branchId
        false           // hasRecentHumanIntervention
      );

      if (!aiResult || !aiResult.response) {
        logger.warn(`⚠️ [MSG] IA no generó respuesta`);
        return;
      }
      logger.info(`✨ [MSG] IA respondió (${aiResult.tokensUsed} tokens)`);

      // 7. ENVIAR RESPUESTA — Usar reply directo al mensaje original para evitar problemas con @lid
      try {
        const chat = await msg.getChat();
        await chat.sendMessage(aiResult.response);
        logger.info(`📤 [MSG] Enviado vía chat directo a ${chatId}`);
      } catch (replyErr) {
        logger.warn(`⚠️ [MSG] Reply directo falló, intentando sendMessage...`);
        await whatsappService.sendMessage(branchId, chatId, aiResult.response);
        logger.info(`📤 [MSG] Enviado vía sendMessage a ${chatId}`);
      }

      // 8. Guardar respuesta IA
      await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);

      // 9. Actualizar clasificación si aplica
      if (aiResult.actions?.classification) {
        await crmService.updateClassification(contact.id, aiResult.actions.classification);
      }

    } catch (error) {
      logger.error(`❌ [MSG] Error para ${chatId}:`, error);
      try {
        const chat = await msg.getChat();
        await chat.sendMessage('Dame un momento... ¡Un placer saludarte! ✨');
      } catch (e) {}
    }
  }
}

module.exports = new MessageController();

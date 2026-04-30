const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');

class MessageController {
  constructor() {
    // Deduplicación: evitar procesar el mismo mensaje 2 veces
    this.processedMessages = new Set();
  }

  /**
   * Procesa un mensaje entrante de WhatsApp
   */
  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = msg.body || '';
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    try {
      // 0. DEDUPLICACIÓN
      if (this.processedMessages.has(msgId)) return;
      this.processedMessages.add(msgId);
      // Limpiar después de 30 segundos para no acumular memoria
      setTimeout(() => this.processedMessages.delete(msgId), 30000);

      // 1. IGNORAR ESTADOS, GRUPOS Y MENSAJES PROPIOS
      if (chatId === 'status@broadcast' || chatId.includes('@g.us')) return;
      if (msg.fromMe) return;
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

      // 7. ENVIAR RESPUESTA — Directo por whatsappService (evita timeouts de Puppeteer con @lid)
      const sent = await whatsappService.sendMessage(branchId, chatId, aiResult.response);
      if (sent) {
        logger.info(`📤 [MSG] Enviado a ${chatId}`);
      } else {
        logger.warn(`⚠️ [MSG] No se pudo enviar a ${chatId}`);
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

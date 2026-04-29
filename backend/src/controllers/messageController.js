const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const syncService = require('../services/syncService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class MessageController {
  /**
   * Procesa un mensaje entrante de WhatsApp
   */
  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = msg.body || '';

    try {
      logger.info(`🔍 [WA-DEBUG] Procesando mensaje de ${chatId} en sucursal ${branchId}: "${body.substring(0, 50)}..."`);

      // 1. Ignorar grupos
      if (chatId.includes('@g.us')) {
        logger.info(`ℹ️ [WA-DEBUG] Ignorando mensaje de grupo.`);
        return;
      }

      if (!body.trim()) {
        logger.info(`ℹ️ [WA-DEBUG] Mensaje vacío, ignorando.`);
        return;
      }

      // 2. Identificar cliente
      let customer = await crmService.getOrCreateCustomer(chatId);
      logger.info(`👤 [WA-DEBUG] Cliente: ${customer.name || 'Sin nombre'} (${chatId})`);

      // 3. Obtener o crear conversación
      let conversation = await crmService.getOrCreateConversation(customer.id, branchId);
      logger.info(`💬 [WA-DEBUG] Conversación ID: ${conversation.id}`);

      // Si la conversación está en modo humano, solo guardamos el mensaje
      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        logger.info(`🤫 [WA-DEBUG] Conversación en modo humano. IA en silencio.`);
        await crmService.saveMessage(conversation.id, 'USER', body);
        return;
      }

      // 4. Cargar historial reciente
      const lastMessages = await crmService.getLastMessages(conversation.id, 10);
      logger.info(`📚 [WA-DEBUG] Contexto cargado: ${lastMessages.length} mensajes previos.`);

      // 5. Guardar mensaje del usuario
      await crmService.saveMessage(conversation.id, 'USER', body);

      // 6. Generar respuesta con IA
      logger.info(`🤖 [WA-DEBUG] Generando respuesta con IA...`);
      const aiResult = await aiService.generateResponse(body, lastMessages, branchId, customer);
      
      if (!aiResult || !aiResult.response) {
        logger.warn(`⚠️ [WA-DEBUG] IA no generó respuesta.`);
        return;
      }
      logger.info(`✨ [WA-DEBUG] IA generó respuesta de ${aiResult.response.length} caracteres.`);

      // 7. Enviar respuesta por WhatsApp
      await whatsappService.sendMessage(branchId, chatId, aiResult.response);
      logger.info(`📤 [WA-DEBUG] Respuesta enviada a WhatsApp.`);

      // 8. Guardar respuesta de la IA en el CRM
      await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);

      // 9. Procesar acciones adicionales (imágenes, audios, etc.)
      if (aiResult.actions?.images?.length > 0) {
        logger.info(`🖼️ [WA-DEBUG] Enviando ${aiResult.actions.images.length} imágenes...`);
        for (const imgUrl of aiResult.actions.images) {
            await whatsappService.sendMedia(branchId, chatId, imgUrl);
        }
      }

    } catch (error) {
      logger.error(`❌ [WA-DEBUG] Error en handleIncomingMessage para ${chatId}:`, error);
      try {
        await whatsappService.sendMessage(branchId, chatId, 'Dame un momento y consulto con mi compañero... ¡Un placer saludarte! ✨');
      } catch (e) {}
    }
  }
}

module.exports = new MessageController();

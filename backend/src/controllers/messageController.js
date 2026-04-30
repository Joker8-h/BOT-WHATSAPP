// ─────────────────────────────────────────────────────────
//  CONTROLLER: Mensajes WhatsApp — Flujo principal
// ─────────────────────────────────────────────────────────
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');

class MessageController {
  constructor() {
    // Deduplicación: evitar procesar el mismo mensaje 2 veces (replay al conectar)
    this.processedMessages = new Set();
  }

  /**
   * Procesa un mensaje entrante de WhatsApp
   * @param {object} msg - Objeto mensaje de whatsapp-web.js
   * @param {number|string} branchIdStr - ID de la sucursal
   */
  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = (msg.body || '').trim();
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    try {
      // ── 0. FILTROS PRIMARIOS ────────────────────────────────
      // Ignorar estados, grupos y mensajes propios
      if (!chatId) return;
      if (chatId === 'status@broadcast') return;
      if (chatId.includes('@g.us')) return;
      if (msg.fromMe) return;
      if (!body) return;

      // ── 1. DEDUPLICACIÓN ────────────────────────────────────
      if (this.processedMessages.has(msgId)) {
        logger.debug(`⏭️ [MSG] Mensaje duplicado ignorado: ${msgId}`);
        return;
      }
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 60000);

      logger.info(`📨 [MSG] De ${chatId}: "${body.substring(0, 60)}"`);

      // ── 2. CRM: Contacto y Conversación ────────────────────
      const contact = await crmService.findOrCreateContact(chatId, branchId);
      logger.info(`👤 [MSG] Cliente: ${contact.name || 'Nuevo'} (ID:${contact.id})`);

      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // Si está en modo humano, solo guardar sin responder
      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        logger.info(`🤫 [MSG] Modo humano activo. Solo guardando mensaje.`);
        await crmService.saveMessage(conversation.id, 'USER', body);
        return;
      }

      // ── 3. Historial de la conversación ────────────────────
      const messageHistory = conversation.messages || [];

      // ── 4. Guardar mensaje del usuario ─────────────────────
      await crmService.saveMessage(conversation.id, 'USER', body);

      // ── 5. Generar respuesta con IA ─────────────────────────
      logger.info(`🤖 [MSG] Generando respuesta IA...`);
      const aiResult = await aiService.generateResponse(
        body,
        contact,
        messageHistory,
        branchId,
        false
      );

      if (!aiResult?.response) {
        logger.warn(`⚠️ [MSG] IA no generó respuesta válida`);
        return;
      }
      logger.info(`✨ [MSG] IA respondió [${aiResult.flow}] (${aiResult.tokensUsed} tokens)`);

      // ── 6. Enviar respuesta principal ─────────────────────
      const sent = await whatsappService.sendMessage(branchId, chatId, aiResult.response);
      logger.info(sent ? `📤 [MSG] Enviado a ${chatId}` : `⚠️ [MSG] Fallo envío a ${chatId}`);

      // ── 7. Guardar respuesta IA en CRM ────────────────────
      await crmService.saveMessage(
        conversation.id,
        'ASSISTANT',
        aiResult.response,
        null,
        aiResult.tokensUsed
      );

      // ── 8. Procesar acciones capturadas por IA ────────────
      const actions = aiResult.actions || {};

      // Guardar datos del cliente capturados por Sofía
      const contactUpdates = {};
      if (actions.capturedName && !contact.name) {
        contactUpdates.name = actions.capturedName;
      }
      if (actions.capturedFullName) {
        contactUpdates.name = actions.capturedFullName;
      }
      if (actions.capturedCity) {
        contactUpdates.city = actions.capturedCity;
      }
      if (actions.capturedAddress) {
        contactUpdates.address = actions.capturedAddress;
      }
      if (actions.capturedNeighborhood) {
        contactUpdates.neighborhood = actions.capturedNeighborhood;
      }

      if (Object.keys(contactUpdates).length > 0) {
        await crmService.updateContactInfo(contact.id, contactUpdates);
        logger.info(`💾 [MSG] Datos del cliente actualizados: ${JSON.stringify(contactUpdates)}`);
      }

      // Actualizar clasificación del cliente
      if (actions.classification) {
        await crmService.updateClassification(contact.id, actions.classification);
      }

      // Escalar a humano si la IA lo indica
      if (actions.shouldEscalate) {
        await crmService.escalateConversation(conversation.id);
        logger.info(`🆘 [MSG] Conversación ${conversation.id} escalada a humano`);
      }

      // Enviar imágenes adicionales de productos
      if (actions.images?.length > 0) {
        for (const imgUrl of actions.images) {
          if (imgUrl && imgUrl.startsWith('http')) {
            await whatsappService.sendMedia(branchId, chatId, imgUrl);
          }
        }
      }

    } catch (error) {
      logger.error(`❌ [MSG] Error procesando mensaje de ${chatId}:`, error.message);
      // Enviar mensaje de error SIN usar Puppeteer (solo whatsappService)
      whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Enseguida te atiendo! 😊')
        .catch(() => {}); // Silenciar error secundario
    }
  }
}

module.exports = new MessageController();

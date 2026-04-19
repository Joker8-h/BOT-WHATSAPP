const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const catalogService = require('../services/catalogService');
const whatsappService = require('../services/whatsappService');
const notificationService = require('../services/notificationService'); // Nuevo servicio de alertas
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { formatCOP } = require('../utils/helpers');

class MessageController {
  /**
   * Procesa un mensaje entrante de WhatsApp
   */
  async handleIncomingMessage(msg) {
    const chatId = msg.from;
    const userMessage = msg.body?.trim();

    if (!userMessage) return;

    const phone = chatId.replace('@c.us', '');
    const branchId = msg.branchId; 
    
    logger.info(`📩 [Branch ${branchId}] Mensaje de ${phone}`);

    try {
      // 0. DETECCIÓN DE EMPLEADO (MODO CONSULTA INTERNA)
      const employeeRecord = await prisma.employeeAccess.findUnique({
        where: {
          phone_branchId: {
            phone: phone,
            branchId: branchId
          }
        }
      });
      const isEmployee = !!employeeRecord;
      
      if (isEmployee) {
        logger.info(`🛠️ [MODO EMPLEADO] Consulta de ${phone}`);
        const employeeResult = await aiService.generateEmployeeResponse(userMessage, branchId);
        await whatsappService.sendMessage(branchId, chatId, employeeResult.response);
        
        // Imágenes para empleados
        if (employeeResult.actions?.images?.length > 0) {
          for (const imageUrl of employeeResult.actions.images.slice(0, 2)) {
            await whatsappService.sendMedia(branchId, chatId, imageUrl);
          }
        }
        return;
      }

      // 1. Obtener o crear contacto en el CRM
      const contact = await crmService.findOrCreateContact(phone, branchId, null);

      // 2. Obtener o crear conversación activa
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // 3. Guardar mensaje del usuario
      await crmService.saveMessage(conversation.id, 'USER', userMessage, msg.id?._serialized);

      // 4. Preparar historial para la IA
      const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          take: 10
      });
      const messageHistory = recentMessages.reverse().map(m => ({
        role: m.role,
        content: m.content,
      }));

      // 5. Generar respuesta con IA (Personalidad de Ventas Fantasías)
      const aiResult = await aiService.generateResponse(userMessage, contact, messageHistory, branchId);

      // 6. Procesar acciones especiales y NOTIFICACIONES
      
      // ── ALERTA: Escalamiento a humano ──
      if (aiResult.actions?.shouldEscalate) {
        await crmService.escalateConversation(conversation.id);
        await whatsappService.sendMessage(branchId, chatId, aiResult.response);
        
        // Notificar a MULTIPLES empleados configurados
        await notificationService.notifyEmployees(
            whatsappService, 
            branchId, 
            `🙋‍♂️ *AYUDA HUMANA REQUERIDA*\nCliente: ${contact.name || phone}\nSede: ${branchId}\nMensaje: "${userMessage}"`
        );
        
        await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);
        return;
      }

      // ── ALERTA: Cierre de venta (Link Wompi + Notificación) ──
      if (aiResult.actions?.shouldCloseSale && aiResult.actions?.productToSell) {
        const product = await catalogService.findProductByName(aiResult.actions.productToSell, branchId);

        if (product) {
          const order = await crmService.createOrder({
            contactId: contact.id,
            branchId: branchId,
            items: [{ productId: product.id, quantity: 1, price: product.price }],
            amount: product.price
          });

          let saleMessage = aiResult.response;
          try {
            const wompiService = require('../services/wompiService');
            const checkout = await wompiService.generatePaymentLink({
              branchId: branchId,
              amount: product.price,
              name: product.name,
              description: `Fantasías: ${product.name}`,
              reference: String(order.id)
            });

            if (checkout?.url) {
              saleMessage += `\n\n💳 *Link de pago seguro:* \n${checkout.url}\n\n💰 Precio: ${formatCOP(product.price)}`;
              
              // NOTIFICACIÓN DE VENTA LISTA
              await notificationService.notifyEmployees(
                whatsappService, 
                branchId, 
                `🔥 *VENTA LISTA PARA COBRO*\nProducto: ${product.name}\nValor: ${formatCOP(product.price)}\nCliente: ${phone}`
              );

              await prisma.order.update({
                where: { id: order.id },
                data: { wompiPaymentLink: checkout.url }
              });
            } else {
              saleMessage += `\n\n💰 Precio: ${formatCOP(product.price)}\n\n💬 Un asesor te confirmará los detalles de pago de inmediato.`;
            }
          } catch (payError) {
            saleMessage += `\n\n💰 Precio: ${formatCOP(product.price)}\n\n💬 Un asesor validará tu pedido enseguida.`;
          }

          await whatsappService.sendMessage(branchId, chatId, saleMessage);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', saleMessage, null, aiResult.tokensUsed);
          return;
        }
      }

      // 8. Enviar respuesta normal
      await whatsappService.sendMessage(branchId, chatId, aiResult.response);

      // 8b. ENVIAR IMÁGENES SI EXISTEN
      if (aiResult.actions?.images?.length > 0) {
        for (const imageUrl of aiResult.actions.images.slice(0, 2)) {
           await whatsappService.sendMedia(branchId, chatId, imageUrl);
        }
      }

      // 9. Guardar respuesta del bot
      await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);

    } catch (error) {
      logger.error(`Error procesando mensaje de ${phone}:`, error);
      try {
        await whatsappService.sendMessage(branchId, chatId, 'Lo lamento, mis sentidos están algo confundidos. Un asesor humano te atenderá pronto 😊');
      } catch (e) {}
    }
  }
}

module.exports = new MessageController();

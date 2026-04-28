const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const catalogService = require('../services/catalogService');
const whatsappService = require('../services/whatsappService');
const visualService = require('../services/visualService');
const notificationService = require('../services/notificationService'); // Nuevo servicio de alertas
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { formatCOP } = require('../utils/helpers');
const fs = require('fs');

class MessageController {
  /**
   * Procesa un mensaje entrante de WhatsApp
   */
  async handleIncomingMessage(msg) {
    const chatId = msg.from;
    const userMessage = msg.body?.trim();

    // IGNORAR GRUPOS PARA EVITAR ERRORES DE BD
    if (chatId.endsWith('@g.us')) return;

    if (!userMessage) return;

    // ── HORARIO DE ATENCIÓN: Lunes a Sábado, 9am a 7pm (Colombia UTC-5) ──
    const nowColombia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const hour = nowColombia.getHours();
    const day = nowColombia.getDay(); // 0=Domingo, 6=Sábado
    
    const isBusinessHours = day >= 1 && day <= 6 && hour >= 9 && hour < 19;

    let phone = chatId.split('@')[0];
    // Conservar el sufijo si es de tipo @lid para evitar colisiones y mantener el ID real
    if (chatId.includes('@lid')) {
      phone = chatId.replace('@c.us', '');
    }
    
    // Truncar solo si no es un ID especial y excede el límite de la BD (asumiendo 20 por ahora, pero mejorado)
    if (!chatId.includes('@lid') && phone.length > 20) phone = phone.substring(0, 20);
    
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

      // Si la conversación ya fue escalada a humano o pausada, no respondemos con IA
      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        logger.info(`🤫 Conversación ${conversation.id} en modo humano. IA en silencio.`);
        await crmService.saveMessage(conversation.id, 'USER', userMessage, msg.id?._serialized);
        return;
      }

      // 3. Guardar mensaje del usuario (SIEMPRE, incluso fuera de horario)
      await crmService.saveMessage(conversation.id, 'USER', userMessage, msg.id?._serialized);

      // 3b. Si estamos FUERA de horario, guardar pero NO responder con IA
      if (!isBusinessHours) {
        logger.info(`🕐 Mensaje de ${phone} guardado (fuera de horario). Se responderá a las 9am.`);
        // Marcar la conversación para procesamiento pendiente
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { context: { ...(conversation.context || {}), pendingOfflineReply: true } }
        });
        return;
      }

      // 4. Preparar historial para la IA (más mensajes para dar contexto completo)
      const recentMessages = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          take: 20
      });
      const messageHistory = recentMessages.reverse().map(m => ({
        role: m.role,
        content: m.content,
      }));

      // 4b. Detectar si un humano/empleado estuvo chateando antes
      // (mensajes de ASSISTANT que NO fueron generados por IA, es decir, mensajes manuales)
      const hasRecentHumanIntervention = conversation.status === 'ACTIVE' && 
        conversation.messages && conversation.messages.length > 0 &&
        conversation.messages.some(m => m.role === 'ASSISTANT' && !m.tokensUsed);

      // 5. Generar respuesta con IA (Personalidad de Ventas Fantasías)
      const aiResult = await aiService.generateResponse(userMessage, contact, messageHistory, branchId, hasRecentHumanIntervention);

      // 5b. Procesar AUDIO si existe la etiqueta [AUDIO:...]
      let audioPath = null;
      if (aiResult.response.includes('[AUDIO:')) {
        const audioMatch = aiResult.response.match(/\[AUDIO:\s*(.+?)\]/i);
        if (audioMatch && audioMatch[1]) {
          const audioText = audioMatch[1];
          logger.info(`🎙️ Generando audio para ${phone}: "${audioText.substring(0, 30)}..."`);
          audioPath = await aiService.generateAudio(audioText);
          
          if (audioPath) {
            await whatsappService.sendMedia(branchId, chatId, audioPath, { isAudio: true });
            // Eliminar la etiqueta del texto final para no confundir al cliente
            aiResult.response = aiResult.response.replace(audioMatch[0], '').trim();
            // Borrar archivo temporal
            setTimeout(() => { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); }, 10000);
          }
        }
      }

      // 6. Procesar acciones especiales y NOTIFICACIONES
      
      // ── ACCIÓN: Capturar Nombre ──
      if (aiResult.actions?.capturedName) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { name: aiResult.actions.capturedName }
        });
        logger.info(`👤 Nombre capturado para ${phone}: ${aiResult.actions.capturedName}`);
      }

      // ── ACCIÓN: Capturar Ciudad ──
      if (aiResult.actions?.capturedCity) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { city: aiResult.actions.capturedCity }
        });
        logger.info(`📍 Ciudad capturada para ${phone}: ${aiResult.actions.capturedCity}`);
      }

      // ── ACCIÓN: Enviar Imágenes (Máximo 4) ──
      if (aiResult.actions?.images?.length > 0) {
        for (const imageUrl of aiResult.actions.images.slice(0, 4)) {
          if (imageUrl && imageUrl.startsWith('http')) {
            await whatsappService.sendMedia(branchId, chatId, imageUrl);
          }
        }
      }

      // ── ALERTA: Escalamiento a humano ──
      if (aiResult.actions?.shouldEscalate) {
        await crmService.escalateConversation(conversation.id);
        await whatsappService.sendMessage(branchId, chatId, aiResult.response);
        
        // Notificar a MULTIPLES empleados configurados
        await notificationService.notifyEmployees(
            whatsappService, 
            branchId, 
            `🙋‍♂️ *AYUDA HUMANA REQUERIDA*\nCliente: ${aiResult.actions?.capturedName || contact.name || phone}\nSede: ${branchId}\nMensaje: "${userMessage}"`
        );
        
        await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);
        return;
      }

      // ── ACCIÓN: Cierre de venta (KITS / Múltiples Productos) ──
      let responseSent = false;
      if (aiResult.actions?.shouldCloseSale && aiResult.actions?.productsToSell?.length > 0) {
        const productNames = aiResult.actions.productsToSell;
        const products = [];
        let totalAmount = 0;
        const items = [];

        for (const pName of productNames) {
          const product = await catalogService.findProductByName(pName, branchId);
          if (product && product.stock > 0) {
            products.push(product);
            totalAmount += product.price;
            items.push({ productId: product.id, quantity: 1, price: product.price });
          }
        }

        if (products.length > 0) {
          // Extraer datos de envío capturados o previos
          const shippingCity = aiResult.actions?.capturedCity || contact.city || null;
          let shippingAddress = aiResult.actions?.capturedAddress || null;
          const neighborhood = aiResult.actions?.capturedNeighborhood || null;
          
          if (neighborhood && shippingAddress) {
            shippingAddress = `${shippingAddress} (Barrio: ${neighborhood})`;
          } else if (neighborhood && !shippingAddress) {
            shippingAddress = `Barrio: ${neighborhood}`;
          }

          // Si no se capturó dirección en este turno, intentar usar la última conocida
          if (!shippingAddress) {
            const lastOrder = await prisma.order.findFirst({
              where: { contactId: contact.id },
              orderBy: { createdAt: 'desc' },
              select: { shippingAddress: true }
            });
            shippingAddress = lastOrder?.shippingAddress || null;
          }

          const order = await crmService.createOrder({
            contactId: contact.id,
            branchId: branchId,
            items: items,
            amount: totalAmount,
            shippingCity: shippingCity,
            shippingAddress: shippingAddress
          });

          // GENERAR Y ENVIAR TICKET VISUAL
          try {
            const ticketUrl = visualService.generateOrderTicket({
              products: products,
              total: totalAmount,
              clientName: aiResult.actions?.capturedName || contact.name || 'Cliente',
              city: shippingCity || 'Colombia'
            });
            await whatsappService.sendMedia(branchId, chatId, ticketUrl);
            logger.info(`🎫 Ticket visual enviado a ${phone}`);
          } catch (e) {
            logger.error('Error enviando ticket visual:', e);
          }

          let saleMessage = aiResult.response;
          try {
            const wompiService = require('../services/wompiService');
            const productListDesc = products.map(p => p.name).join(', ');
            
            const checkout = await wompiService.generatePaymentLink({
              branchId: branchId,
              amount: totalAmount,
              name: products.length > 1 ? `Kit Fantasías (${products.length} productos)` : products[0].name,
              description: `Pedido: ${productListDesc}`,
              reference: String(order.id)
            });

            if (checkout?.url) {
              saleMessage += `\n\n💳 *Link de pago seguro (Total):* \n${checkout.url}\n\n💰 *Total a pagar:* ${formatCOP(totalAmount)}\n📦 *Productos:* ${productListDesc}`;
              
              await notificationService.notifyEmployees(
                whatsappService, 
                branchId, 
                `🔥 *VENTA LISTA (${products.length} items)*\nValor: ${formatCOP(totalAmount)}\nProductos: ${productListDesc}\nCliente: ${phone}`
              );

              await prisma.order.update({
                where: { id: order.id },
                data: { wompiPaymentLink: checkout.url }
              });
            } else {
              saleMessage += `\n\n💰 Total: ${formatCOP(totalAmount)}\n\n💬 Un asesor te confirmará los detalles de pago de inmediato.`;
            }
            } catch (payError) {
              logger.error(`❌ Error en Wompi Service: ${payError.message}`);
              saleMessage += `\n\n💰 Total: ${formatCOP(totalAmount)}\n\n💬 Hubo un detalle técnico con el link de pago, pero no te preocupes, un asesor validará tu pedido enseguida.`;
            }

            await whatsappService.sendMessage(branchId, chatId, saleMessage);
            await crmService.saveMessage(conversation.id, 'ASSISTANT', saleMessage, null, aiResult.tokensUsed);
            responseSent = true;
        }
      }

      // 8. Enviar respuesta normal (Solo si no se envió ya arriba)
      if (!responseSent && aiResult.response) {
        await whatsappService.sendMessage(branchId, chatId, aiResult.response);
        await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResult.response, null, aiResult.tokensUsed);
      }

    } catch (error) {
      logger.error(`Error procesando mensaje de ${phone}:`, error);
      try {
        await whatsappService.sendMessage(branchId, chatId, 'Dame un momento y consulto con mi compañero... ¡Un placer saludarte! ✨');
      } catch (e) {}
    }
  }
}

module.exports = new MessageController();

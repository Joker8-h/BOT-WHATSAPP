// ─────────────────────────────────────────────────────────
//  SERVICE: Follow-Up Automático — Recuperación de Ventas
//  Detecta clientes que dejaron de responder y envía
//  recordatorios inteligentes para cerrar la venta.
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class FollowUpService {
  constructor() {
    this.whatsappService = null;
    this.aiService = null;
  }

  /**
   * Inyectar dependencias (evita dependencias circulares)
   */
  setServices(whatsappService, aiService) {
    this.whatsappService = whatsappService;
    this.aiService = aiService;
  }

  /**
   * CRON principal: Busca conversaciones estancadas y envía follow-ups
   * Se ejecuta cada hora.
   */
  async processFollowUps() {
    if (!this.whatsappService) {
      logger.warn('⚠️ FollowUp: WhatsApp service no inyectado aún.');
      return;
    }

    logger.info('🔔 Iniciando proceso de follow-up automático...');

    try {
      // 1. Buscar conversaciones ACTIVAS donde:
      //    - El último mensaje fue del BOT (ASSISTANT)
      //    - Han pasado entre 4 y 24 horas sin respuesta del cliente
      //    - La conversación NO está pausada/escalada
      //    - No se ha enviado un follow-up previamente en esta conversación
      const now = new Date();
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const stalledConversations = await prisma.conversation.findMany({
        where: {
          status: 'ACTIVE',
          updatedAt: {
            gte: twentyFourHoursAgo,
            lte: fourHoursAgo
          },
          // Solo conversaciones con algo de interacción
          messageCount: { gte: 2 }
        },
        include: {
          contact: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          branch: true
        }
      });

      let sentCount = 0;

      for (const conv of stalledConversations) {
        try {
          // Verificar que el último mensaje sea del bot (el cliente no respondió)
          const lastMsg = conv.messages[0];
          if (!lastMsg || lastMsg.role !== 'ASSISTANT') continue;

          // Verificar que no sea un follow-up ya enviado
          if (lastMsg.content.includes('⏰') || lastMsg.content.includes('follow-up')) continue;

          // Verificar que la sucursal tenga WhatsApp activo
          const branchStatus = this.whatsappService.getBranchStatus(conv.branchId);
          if (!branchStatus?.isReady) continue;

          // Generar un mensaje de follow-up contextual
          const followUpMsg = await this.generateFollowUpMessage(conv);
          if (!followUpMsg) continue;

          // Enviar el mensaje
          const chatId = conv.contact.phone.includes('@') 
            ? conv.contact.phone 
            : `${conv.contact.phone}@c.us`;
          
          const sent = await this.whatsappService.sendMessage(conv.branchId, chatId, followUpMsg);
          
          if (sent) {
            // Guardar en historial
            await prisma.message.create({
              data: {
                conversationId: conv.id,
                role: 'ASSISTANT',
                content: followUpMsg,
                tokensUsed: 0 // No se usó IA para este mensaje
              }
            });
            
            await prisma.conversation.update({
              where: { id: conv.id },
              data: { 
                messageCount: { increment: 1 },
                updatedAt: new Date()
              }
            });

            sentCount++;
            logger.info(`📩 Follow-up enviado a ${conv.contact.name || conv.contact.phone} (Conv: ${conv.id})`);
          }

          // Anti-ban delay entre envíos
          await new Promise(r => setTimeout(r, 5000));

        } catch (err) {
          logger.error(`Error en follow-up para conv ${conv.id}:`, err.message);
        }
      }

      logger.info(`🔔 Follow-up completado: ${sentCount} mensajes enviados de ${stalledConversations.length} conversaciones estancadas.`);

    } catch (error) {
      logger.error('❌ Error en processFollowUps:', error);
    }
  }

  /**
   * Genera un mensaje de follow-up personalizado según el contexto de la conversación
   */
  async generateFollowUpMessage(conversation) {
    const contact = conversation.contact;
    const messages = conversation.messages;
    const name = contact.name || '';

    // Analizar los últimos mensajes para detectar el contexto
    const lastMessages = messages.map(m => m.content).join(' ').toLowerCase();
    
    // ¿Se mencionó un link de pago?
    const mentionedPayment = lastMessages.includes('checkout.wompi') || 
                              lastMessages.includes('link de pago') ||
                              lastMessages.includes('pago');

    // ¿Se mencionaron productos específicos?
    const mentionedProducts = lastMessages.includes('precio') || 
                               lastMessages.includes('$') ||
                               lastMessages.includes('producto');

    // ¿El cliente pidió envío?
    const mentionedShipping = lastMessages.includes('envío') || 
                               lastMessages.includes('domicilio') ||
                               lastMessages.includes('dirección');

    // Seleccionar el template más relevante
    if (mentionedPayment) {
      return this.getPaymentFollowUp(name);
    } else if (mentionedShipping) {
      return this.getShippingFollowUp(name);
    } else if (mentionedProducts) {
      return this.getProductFollowUp(name);
    } else {
      return this.getGeneralFollowUp(name);
    }
  }

  // ── Templates de Follow-Up ──────────────────────────────

  getPaymentFollowUp(name) {
    const templates = [
      `Hola${name ? ` ${name}` : ''} 😊 Vi que te envié el link de pago pero no alcanzaste a completar. ¿Tuviste algún problema con el pago? Estoy aquí para ayudarte ✨`,
      `Hey${name ? ` ${name}` : ''} 💕 ¿Pudiste completar tu pedido? Si necesitas otro método de pago o tienes alguna duda, aquí estoy para ti 🌹`,
      `${name ? `${name}, ` : ''}solo quería asegurarme de que todo esté bien con tu pedido 💫 Si el link de pago te dio algún problema, con gusto te genero uno nuevo. ¡Tu pedido te va a encantar! 🔥`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  getShippingFollowUp(name) {
    const templates = [
      `Hola${name ? ` ${name}` : ''} ✨ Quedamos pendientes con los datos de envío. ¿Me confirmas tu dirección completa para despachar tu pedido? 📦`,
      `${name ? `${name}, ` : ''}te cuento que tenemos despacho rápido disponible 🚀 ¿Me das tu dirección para que tu pedido salga hoy mismo?`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  getProductFollowUp(name) {
    const templates = [
      `Hola${name ? ` ${name}` : ''} 😊 ¿Pudiste pensar en los productos que te mostré? Si quieres que te arme un kit especial o necesitas más opciones, aquí estoy ✨`,
      `${name ? `${name}! ` : '¡Hola! '}Quería contarte que algunos de los productos que viste tienen stock limitado 🔥 Si te interesa alguno, te lo puedo apartar. ¿Qué dices? 😉`,
      `Hey${name ? ` ${name}` : ''} 💕 Sé que a veces es difícil decidirse. Si quieres te ayudo a elegir según lo que buscas, ¡sin compromiso! 🌹`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  getGeneralFollowUp(name) {
    const templates = [
      `Hola${name ? ` ${name}` : ''} 💫 ¿Cómo estás? Quedamos a medias en nuestra conversación. ¿Hay algo en lo que te pueda ayudar? 😊`,
      `${name ? `${name}, ` : ''}por aquí sigo disponible si necesitas algo 🌹 Cuéntame cómo te puedo ayudar ✨`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // ── PROCESAMIENTO DE MENSAJES FUERA DE HORARIO ──────────

  /**
   * Se ejecuta a las 9am (Lun-Sáb). Busca conversaciones con mensajes
   * pendientes enviados fuera de horario y genera respuestas con IA.
   */
  async processOfflineMessages() {
    if (!this.whatsappService || !this.aiService) {
      logger.warn('⚠️ OfflineProcessor: servicios no inyectados.');
      return;
    }

    logger.info('🌅 Procesando mensajes recibidos fuera de horario...');

    try {
      // Buscar conversaciones marcadas con pendingOfflineReply
      const pendingConversations = await prisma.conversation.findMany({
        where: {
          status: 'ACTIVE',
          context: { path: '$.pendingOfflineReply', equals: true }
        },
        include: {
          contact: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 20
          },
          branch: true
        }
      });

      logger.info(`📨 ${pendingConversations.length} conversaciones con mensajes pendientes.`);
      let processedCount = 0;

      for (const conv of pendingConversations) {
        try {
          // Verificar WhatsApp activo
          const branchStatus = this.whatsappService.getBranchStatus(conv.branchId);
          if (!branchStatus?.isReady) {
            logger.warn(`⚠️ Branch ${conv.branchId} no está listo, saltando.`);
            continue;
          }

          // Preparar historial
          const messageHistory = conv.messages.reverse().map(m => ({
            role: m.role,
            content: m.content,
          }));

          // Obtener el último mensaje del usuario (el que escribió fuera de horario)
          const lastUserMsg = conv.messages.filter(m => m.role === 'USER').pop();
          if (!lastUserMsg) continue;

          // Generar respuesta con IA
          const aiResult = await this.aiService.generateResponse(
            lastUserMsg.content,
            conv.contact,
            messageHistory,
            conv.branchId,
            true // hasRecentHumanIntervention = true para que analice el contexto
          );

          // Enviar la respuesta
          const chatId = conv.contact.phone.includes('@')
            ? conv.contact.phone
            : `${conv.contact.phone}@c.us`;

          const sent = await this.whatsappService.sendMessage(conv.branchId, chatId, aiResult.response);

          if (sent) {
            // Guardar respuesta en historial
            await prisma.message.create({
              data: {
                conversationId: conv.id,
                role: 'ASSISTANT',
                content: aiResult.response,
                tokensUsed: aiResult.tokensUsed
              }
            });

            // Limpiar bandera de pendiente
            const currentContext = conv.context || {};
            delete currentContext.pendingOfflineReply;
            await prisma.conversation.update({
              where: { id: conv.id },
              data: {
                messageCount: { increment: 1 },
                context: currentContext,
                updatedAt: new Date()
              }
            });

            // Enviar imágenes si las hay
            if (aiResult.actions?.images?.length > 0) {
              for (const imageUrl of aiResult.actions.images.slice(0, 3)) {
                await this.whatsappService.sendMedia(conv.branchId, chatId, imageUrl);
              }
            }

            processedCount++;
            logger.info(`✅ Respuesta offline enviada a ${conv.contact.name || conv.contact.phone} (Conv: ${conv.id})`);
          }

          // Anti-ban delay
          await new Promise(r => setTimeout(r, 5000));

        } catch (err) {
          logger.error(`Error procesando offline conv ${conv.id}:`, err.message);
        }
      }

      logger.info(`🌅 Procesamiento offline completado: ${processedCount}/${pendingConversations.length} respondidos.`);

    } catch (error) {
      logger.error('❌ Error en processOfflineMessages:', error);
    }
  }
}

module.exports = new FollowUpService();

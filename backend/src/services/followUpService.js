// ─────────────────────────────────────────────────────────
//  SERVICE: Follow-Up Automático — Recuperación de Ventas
//  Seguimientos personalizados con IA según la ficha de venta:
//  3h → 24h → 72h (y reactivación a los 15 días si había interés).
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { isWorkingHours, formatCOP, isPhoneBlocked } = require('../utils/helpers');
const { OBJECTION_LABELS } = require('../ai/saleState');
const { normalizeText, classifyProduct, pickProductOfType } = require('../ai/salesKnowledge');

const HOUR_MS = 60 * 60 * 1000;
const MIN_GAP_BETWEEN_FOLLOWUPS_MS = 18 * HOUR_MS;
const COD_CITIES = ['popayan', 'pitalito', 'florencia', 'yopal'];

const STEPS = [
  {
    minSilenceHours: 3,
    goal: 'Retomar la conversación con suavidad donde quedó: recordar el producto que le interesó (si hay) con su beneficio principal y ofrecer dejárselo listo.',
  },
  {
    minSilenceHours: 24,
    goal: 'Seguimiento amable al día siguiente: recordar el producto que le interesó y resolver la duda u objeción que tuvo. Si le pareció caro y hay una alternativa más económica en los datos, ofrécela.',
  },
  {
    minSilenceHours: 72,
    goal: 'Último seguimiento, sin ninguna presión: preguntar si aún le interesa o si prefiere que le recomiende otra opción, dejando la puerta abierta.',
  },
  {
    minSilenceHours: 15 * 24,
    requiresInterest: true,
    goal: 'Reactivación después de unos días: saludarlo con calidez, contarle que el producto que le interesó sigue disponible y preguntarle si quiere que se lo aparte.',
  },
];

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

  _findCatalogProduct(catalog, name) {
    const target = normalizeText(name);
    if (!target) return null;
    return catalog.find(p => normalizeText(p.name) === target)
      || catalog.find(p => normalizeText(p.name).includes(target) || target.includes(normalizeText(p.name)))
      || null;
  }

  _isCodCity(city) {
    const c = normalizeText(city);
    return !!c && COD_CITIES.some(x => c.includes(x));
  }

  /**
   * Arma el objetivo y los datos reales para el mensaje de seguimiento.
   */
  _buildFollowUpBrief(stepIndex, conv, sale, catalog) {
    const contact = conv.contact;
    const facts = [];
    const interest = (sale.interestProducts || [])
      .map(name => this._findCatalogProduct(catalog, name) || { name })
      .slice(-2);

    for (const p of interest) {
      facts.push(p.price ? `Producto que le interesó: ${p.name} (${formatCOP(p.price)})` : `Producto que le interesó: ${p.name}`);
    }
    if (sale.intent) facts.push(`Intención de compra: ${sale.intent}`);
    if (sale.objections?.length) {
      facts.push(`Objeción que tuvo: ${sale.objections.map(o => OBJECTION_LABELS[o] || o).join('; ')}`);
    }

    const mainInterest = interest.find(p => p.id);
    if (stepIndex >= 1 && mainInterest && sale.objections?.includes('precio')) {
      const type = classifyProduct(mainInterest)[0];
      const cheaper = type
        ? pickProductOfType(type, catalog, { maxPrice: Number(mainInterest.price) - 1, excludeIds: new Set([mainInterest.id]) })
        : null;
      if (cheaper) facts.push(`Alternativa más económica disponible: ${cheaper.name} (${formatCOP(cheaper.price)})`);
    }
    if (!interest.length) facts.push('Aún no eligió un producto concreto: ofrécete a recomendarle algo según lo que busca.');
    if (contact.city) facts.push(`Ciudad del cliente: ${contact.city}`);

    return { goal: STEPS[stepIndex].goal, facts, interest };
  }

  _fallbackFollowUp(stepIndex, name, interest) {
    const hi = name ? `Hola ${name} 💜` : 'Hola 💜';
    const product = interest?.[interest.length - 1]?.name;
    if (stepIndex === 0) {
      return product
        ? `${hi}\n\nQuedé pendiente contigo con *${product}*.\n\n¿Te lo dejo listo o tienes alguna duda que te pueda resolver?`
        : `${hi}\n\nQuedamos a medias en nuestra conversación.\n\n¿Te ayudo a elegir la mejor opción para lo que buscas?`;
    }
    if (stepIndex === 1) {
      return product
        ? `${hi}\n\nSigo pendiente por si quieres llevar *${product}*.\n\n¿Quieres que te cuente algo más para decidirte?`
        : `${hi}\n\n¿Pudiste pensar en lo que hablamos?\n\nCon gusto te recomiendo algo según tu presupuesto ✨`;
    }
    if (stepIndex === 2) {
      return `${hi}\n\nNo quiero molestarte, solo saber si aún te interesa o si prefieres que te recomiende otra opción.\n\nAquí estoy cuando quieras ✨`;
    }
    return product
      ? `${hi}\n\n*${product}* sigue disponible por si aún lo tienes en mente.\n\n¿Quieres que te lo aparte?`
      : `${hi}\n\nTenemos novedades que te pueden gustar.\n\n¿Te las muestro?`;
  }

  _fallbackPayment(name) {
    const hi = name ? `Hola ${name} 💜` : 'Hola 💜';
    return `${hi}\n\nVi que quedó pendiente el pago de tu pedido.\n\n¿Tuviste algún inconveniente? Te ayudo con gusto ✨`;
  }

  /**
   * CRON principal (cada hora en horario laboral): conversaciones donde el
   * cliente dejó de responder después de un mensaje de Sofía.
   */
  async processFollowUps() {
    if (!this.whatsappService) {
      logger.warn('⚠️ FollowUp: WhatsApp service no inyectado aún.');
      return;
    }

    if (!(await isWorkingHours()).isWorking) {
      logger.info('🌙 [FollowUp-SKIP] Fuera de horario laboral.');
      return;
    }

    logger.info('🔔 Iniciando proceso de follow-up inteligente...');
    const crmService = require('./crmService');
    const catalogService = require('./catalogService');
    const now = new Date();

    try {
      const candidates = await prisma.conversation.findMany({
        where: {
          status: 'ACTIVE',
          messageCount: { gte: 2 },
          updatedAt: {
            lte: new Date(now.getTime() - STEPS[0].minSilenceHours * HOUR_MS),
            gte: new Date(now.getTime() - 20 * 24 * HOUR_MS),
          },
        },
        include: {
          contact: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 12 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });

      let sentCount = 0;

      for (const conv of candidates) {
        try {
          const contact = conv.contact;
          if (!contact || contact.isBlocked || isPhoneBlocked(contact.phone)) continue;

          const context = (conv.context && typeof conv.context === 'object') ? conv.context : {};
          if (context.pendingOfflineReply) continue;

          const lastMsg = conv.messages[0];
          if (!lastMsg || lastMsg.role !== 'ASSISTANT') continue;

          const lastUser = conv.messages.find(m => m.role === 'USER');
          if (!lastUser) continue;

          const sale = context.sale || {};
          if (sale.stage === 'comprado') continue; // de aquí en adelante se encarga la postventa

          // El contador se reinicia cada vez que el cliente vuelve a escribir
          let followUp = context.followUp || {};
          if (followUp.anchorMessageId !== lastUser.id) followUp = { count: 0 };

          const stepIndex = followUp.count || 0;
          const step = STEPS[stepIndex];
          if (!step) continue;

          const silenceMs = now - new Date(lastUser.createdAt);
          if (silenceMs < step.minSilenceHours * HOUR_MS) continue;
          if (followUp.lastAt && now - new Date(followUp.lastAt) < MIN_GAP_BETWEEN_FOLLOWUPS_MS) continue;
          if (context.lastOutreachAt && now - new Date(context.lastOutreachAt) < MIN_GAP_BETWEEN_FOLLOWUPS_MS) continue;
          if (step.requiresInterest && !sale.interestProducts?.length) continue;

          const branchId = conv.branchId || contact.branchId || 1;
          if (!this.whatsappService.getBranchStatus(branchId)?.isReady) continue;

          const chatId = contact.phone.includes('@') ? contact.phone : `${contact.phone}@c.us`;
          const firstName = contact.name && contact.name !== 'Sin nombre' ? contact.name.split(' ')[0] : '';
          const history = [...conv.messages].reverse();
          let sent = false;

          if (sale.stage === 'link_enviado' && sale.pendingPayment) {
            sent = await this._sendPaymentFollowUp({ conv, contact, chatId, branchId, sale, context, stepIndex, history, firstName });
          } else {
            const catalog = await catalogService.getAllProducts(branchId);
            const { goal, facts, interest } = this._buildFollowUpBrief(stepIndex, conv, sale, catalog);
            const text = (this.aiService && await this.aiService.generateOutreachMessage({ contact, goal, facts, history }))
              || this._fallbackFollowUp(stepIndex, firstName, interest);

            sent = await this.whatsappService.sendMessage(branchId, chatId, text);
            if (sent) await crmService.saveMessage(conv.id, 'ASSISTANT', text);
          }

          if (!sent) continue;

          await crmService.patchContext(conv.id, (ctx) => ({
            ...ctx,
            followUp: { count: stepIndex + 1, lastAt: now.toISOString(), anchorMessageId: lastUser.id },
            lastOutreachAt: now.toISOString(),
            lastFollowUpAt: now.toISOString(),
          }));

          sentCount++;
          logger.info(`📩 Follow-up #${stepIndex + 1} enviado a ${contact.name || contact.phone} (Conv: ${conv.id})`);
          await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
          logger.error(`Error en follow-up para conv ${conv.id}:`, err.message);
        }
      }

      logger.info(`🔔 Follow-up completado: ${sentCount} mensajes enviados de ${candidates.length} conversaciones revisadas.`);
    } catch (error) {
      logger.error('❌ Error en processFollowUps:', error);
    }
  }

  /**
   * Link de pago enviado y no pagado: recordatorio amable y, desde el segundo
   * seguimiento, un link nuevo (y la opción contraentrega si su ciudad aplica).
   */
  async _sendPaymentFollowUp({ conv, contact, chatId, branchId, sale, context, stepIndex, history, firstName }) {
    const crmService = require('./crmService');
    const payment = sale.pendingPayment;
    const codAvailable = this._isCodCity(contact.city);
    await this._alertOwnerLinkAbandoned({ conv, contact, branchId, payment });

    const facts = [
      `Pedido pendiente de pago: ${(payment.products || []).join(', ')} por ${formatCOP(payment.amount)}`,
    ];
    if (codAvailable) facts.push(`Su ciudad (${contact.city}) tiene pago contra entrega en efectivo como alternativa`);

    const goal = `Recordar con amabilidad que quedó pendiente el pago de su pedido, preguntar si tuvo algún inconveniente con el link y ofrecer ayuda.${codAvailable ? ' Mencionar que si prefiere, también puede pagar en efectivo contra entrega.' : ''}${stepIndex >= 1 ? ' Decirle que le envías un link nuevo aquí mismo.' : ''}`;

    const text = (this.aiService && await this.aiService.generateOutreachMessage({ contact, goal, facts, history }))
      || this._fallbackPayment(firstName);

    const cart = context.pendingCarts?.[payment.reference];
    if (stepIndex >= 1 && cart) {
      const messageController = require('../controllers/messageController');
      const link = await messageController.sendPaymentLink({
        conversationId: conv.id, contact, chatId, branchId, cartData: cart, productNames: payment.products || [], intro: text,
      });
      if (link) return true;
    }

    const sent = await this.whatsappService.sendMessage(branchId, chatId, text);
    if (sent) await crmService.saveMessage(conv.id, 'ASSISTANT', text);
    return sent;
  }

  async _alertOwnerLinkAbandoned({ conv, contact, branchId, payment }) {
    const ownerAlertService = require('./ownerAlertService');
    await ownerAlertService.onLinkAbandoned({ contact, conversation: conv, branchId, pending: payment })
      .catch(err => logger.warn(`⚠️ [OWNER-ALERT] link_abandoned: ${err.message}`));
  }

  // ── PROCESAMIENTO DE MENSAJES FUERA DE HORARIO ──────────

  /**
   * Se ejecuta a las 9am (Lun-Sáb). Responde los mensajes que llegaron fuera
   * de horario pasando por el MISMO pipeline que el tiempo real (pedidos,
   * datos del cliente, links de pago, ficha de venta).
   */
  async processOfflineMessages() {
    if (!this.whatsappService || !this.aiService) {
      logger.warn('⚠️ OfflineProcessor: servicios no inyectados.');
      return;
    }

    if (!(await isWorkingHours()).isWorking) {
      logger.info('🌙 [Offline-SKIP] Fuera de horario laboral.');
      return;
    }

    logger.info('🌅 Procesando mensajes recibidos fuera de horario...');
    const crmService = require('./crmService');
    const messageController = require('../controllers/messageController');

    try {
      const pendingConversations = await prisma.conversation.findMany({
        where: {
          status: 'ACTIVE',
          context: { path: '$.pendingOfflineReply', equals: true }
        },
        include: {
          contact: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 20 },
        }
      });

      logger.info(`📨 ${pendingConversations.length} conversaciones con mensajes pendientes.`);
      let processedCount = 0;

      for (const conv of pendingConversations) {
        try {
          const branchId = conv.branchId || conv.contact.branchId || 1;
          if (!this.whatsappService.getBranchStatus(branchId)?.isReady) {
            logger.warn(`⚠️ Branch ${branchId} no está listo, saltando.`);
            continue;
          }

          const chronological = [...conv.messages].reverse();

          // Todos los mensajes que el cliente escribió desde la última respuesta de Sofía
          let splitIdx = chronological.length;
          while (splitIdx > 0 && chronological[splitIdx - 1].role === 'USER') splitIdx--;
          const pendingUserMsgs = chronological.slice(splitIdx);
          const messageHistory = chronological.slice(0, splitIdx);

          await crmService.patchContext(conv.id, (ctx) => {
            const next = { ...ctx };
            delete next.pendingOfflineReply;
            return next;
          });

          if (!pendingUserMsgs.length) continue;
          const userMessage = pendingUserMsgs.map(m => m.content).join('\n');

          const chatId = conv.contact.phone.includes('@') ? conv.contact.phone : `${conv.contact.phone}@c.us`;
          const aiResult = await this.aiService.generateResponse(
            userMessage,
            conv.contact,
            messageHistory,
            branchId,
            true,
            null,
            { conversation: conv }
          );
          if (!aiResult?.response) continue;

          await messageController.processAiResult({
            aiResult,
            contact: conv.contact,
            conversation: conv,
            chatId,
            branchId,
            body: userMessage,
            messageHistory,
          });

          processedCount++;
          logger.info(`✅ Respuesta offline enviada a ${conv.contact.name || conv.contact.phone} (Conv: ${conv.id})`);

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

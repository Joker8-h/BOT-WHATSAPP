// ─────────────────────────────────────────────────────────
//  SERVICE: Postventa y recompra (Manual — módulos 18 y 19)
//  Día 1: ¿ya lo recibió? + tip · Día 3: complemento
//  Día 7: estados / VIP · Día 20: recompra
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { isWorkingHours, formatCOP, isPhoneBlocked } = require('../utils/helpers');
const {
  classifyProduct, pickComplements, getRepurchaseTypes, pickProductOfType,
} = require('../ai/salesKnowledge');

const DAY_MS = 24 * 60 * 60 * 1000;
const VIP_THRESHOLD = 150000;

// dayOffset: días desde la compra en que se envía cada paso
const STEPS = [
  { step: 1, dayOffset: 1 },
  { step: 2, dayOffset: 3 },
  { step: 3, dayOffset: 7 },
  { step: 4, dayOffset: 20 },
];

const ELIGIBLE_STATUSES = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED'];

class PostSaleService {
  constructor() {
    this.whatsappService = null;
    this.aiService = null;
  }

  setServices(whatsappService, aiService) {
    this.whatsappService = whatsappService;
    this.aiService = aiService;
  }

  /**
   * Programa la secuencia de postventa para un pedido recién confirmado.
   */
  async schedule(orderId) {
    try {
      await prisma.order.update({
        where: { id: orderId },
        data: { postSaleStep: 0, postSaleNextAt: new Date(Date.now() + STEPS[0].dayOffset * DAY_MS) },
      });
      logger.info(`🗓️ [POSTSALE] Secuencia programada para pedido #${orderId}`);
    } catch (error) {
      logger.error(`Error programando postventa del pedido #${orderId}:`, error.message);
    }
  }

  _buildStepContent(stepNumber, order, catalog) {
    const items = order.items.filter(i => i.product);
    const productNames = items.map(i => i.product.name);
    const mainItem = [...items].sort((a, b) => Number(b.price) - Number(a.price))[0];
    const facts = [`Compró: ${productNames.join(', ')} (${formatCOP(order.amount)})`];
    let goal;
    let suggested = null;

    if (stepNumber === 1) {
      goal = 'Preguntar con calidez si ya recibió su pedido y ofrecerle un tip rápido para disfrutar mejor su producto.';
    } else if (stepNumber === 2) {
      const complement = mainItem ? pickComplements(mainItem.product, catalog, 1)[0] : null;
      if (complement) {
        suggested = complement.product;
        facts.push(`Complemento ideal para lo que compró: ${suggested.name} (${formatCOP(suggested.price)})`);
        goal = 'Contarle que muchos clientes complementan su producto con el complemento indicado para mejorar la experiencia, y preguntarle si quiere que se lo envíe o le cuente más.';
      } else {
        goal = 'Preguntarle cómo le fue con su producto y si quiere que le recomiende algo para complementar la experiencia.';
      }
    } else if (stepNumber === 3) {
      const isVip = Number(order.amount) >= VIP_THRESHOLD;
      goal = isVip
        ? 'Recordarle que por su compra superior a $150.000 es cliente VIP (descuentos especiales, rifas y novedades) e invitarlo a guardar el contacto como "Sofía — Fantasías" para ver tips y novedades en los estados. Pedirle que confirme cuando lo guarde.'
        : 'Invitarlo a guardar el contacto como "Sofía — Fantasías" para ver tips de pareja, novedades y promociones en los estados. Pedirle que confirme cuando lo guarde.';
      if (isVip) facts.push('Es cliente VIP por compra mayor a $150.000');
    } else {
      const purchasedIds = new Set(items.map(i => i.productId));
      const purchasedTypes = [...new Set(items.flatMap(i => classifyProduct(i.product)))];
      for (const type of getRepurchaseTypes(purchasedTypes)) {
        const pick = pickProductOfType(type, catalog, { excludeIds: purchasedIds });
        if (pick) { suggested = pick; break; }
      }
      if (suggested) {
        facts.push(`Recomendación nueva según lo que compró: ${suggested.name} (${formatCOP(suggested.price)})`);
        goal = 'Saludarlo después de unos días, contarle que tienes algo que podría gustarle según su compra anterior (la recomendación indicada) y preguntarle si quiere que se lo muestre.';
      } else {
        goal = 'Saludarlo después de unos días y contarle que llegaron novedades que podrían gustarle; preguntarle si quiere que se las muestre.';
      }
    }

    return { goal, facts, suggested };
  }

  _fallbackText(stepNumber, name, suggested) {
    const hi = name ? `Hola ${name} 💜` : 'Hola 💜';
    switch (stepNumber) {
      case 1: return `${hi}\n\n¿Ya recibiste tu pedido?\n\nSi quieres, te doy un tip rápido para disfrutarlo mejor ✨`;
      case 2: return suggested
        ? `${hi}\n\nMuchos clientes complementan su compra con *${suggested.name}* para una experiencia más completa.\n\n¿Quieres que te cuente cómo funciona?`
        : `${hi}\n\n¿Cómo te fue con tu producto?\n\nSi quieres, te recomiendo algo para complementar la experiencia ✨`;
      case 3: return `${hi}\n\nEstamos compartiendo tips y novedades en nuestros estados.\n\nGuárdanos como "Sofía — Fantasías" para que no te pierdas nada ✨ ¿Ya nos tienes agregados?`;
      default: return suggested
        ? `${hi}\n\nTengo algo que te podría encantar según tu última compra: *${suggested.name}*.\n\n¿Quieres que te lo muestre?`
        : `${hi}\n\nNos llegaron novedades que te podrían gustar.\n\n¿Quieres que te las muestre?`;
    }
  }

  /**
   * CRON: envía los pasos de postventa que ya vencieron.
   */
  async processPostSales() {
    if (!this.whatsappService || !this.aiService) {
      logger.warn('⚠️ PostSale: servicios no inyectados aún.');
      return;
    }
    if (!(await isWorkingHours()).isWorking) return;

    const crmService = require('./crmService');
    const catalogService = require('./catalogService');
    const now = new Date();

    try {
      const dueOrders = await prisma.order.findMany({
        where: {
          postSaleNextAt: { lte: now },
          postSaleStep: { lt: STEPS.length },
          status: { in: ELIGIBLE_STATUSES },
        },
        include: { contact: true, items: { include: { product: true } } },
        orderBy: { postSaleNextAt: 'asc' },
        take: 30,
      });

      if (!dueOrders.length) return;
      logger.info(`💌 [POSTSALE] ${dueOrders.length} pasos de postventa pendientes.`);
      const contactedNow = new Set();

      for (const order of dueOrders) {
        try {
          const contact = order.contact;
          if (!contact || contact.isBlocked || isPhoneBlocked(contact.phone) || contactedNow.has(contact.id)) continue;

          // Un pedido pendiente que no es contraentrega es un link sin pagar: no es una venta aún
          if (order.status === 'PENDING' && order.paymentMethod !== 'CONTRAENTREGA') continue;

          // No interrumpir una conversación en vivo: se reintenta en la próxima corrida
          if (contact.lastMessageAt && now - new Date(contact.lastMessageAt) < 6 * 60 * 60 * 1000) continue;

          const branchId = order.branchId || contact.branchId || 1;
          if (!this.whatsappService.getBranchStatus(branchId)?.isReady) continue;

          const conversation = await crmService.getActiveConversation(contact.id, branchId);
          const lastOutreachAt = conversation.context?.lastOutreachAt ? new Date(conversation.context.lastOutreachAt) : null;
          if (lastOutreachAt && now - lastOutreachAt < 20 * 60 * 60 * 1000) continue;

          const stepNumber = order.postSaleStep + 1;
          const catalog = await catalogService.getAllProducts(branchId);
          const { goal, facts, suggested } = this._buildStepContent(stepNumber, order, catalog);

          const firstName = contact.name && contact.name !== 'Sin nombre' ? contact.name.split(' ')[0] : '';
          const text = (await this.aiService.generateOutreachMessage({
            contact, goal, facts, history: conversation.messages || [],
          })) || this._fallbackText(stepNumber, firstName, suggested);

          const chatId = contact.phone.includes('@') ? contact.phone : `${contact.phone}@c.us`;
          const sent = await this.whatsappService.sendMessage(branchId, chatId, text);
          if (!sent) continue;

          await crmService.saveMessage(conversation.id, 'ASSISTANT', text);
          await crmService.patchContext(conversation.id, (ctx) => {
            const sale = { ...(ctx.sale || {}), stage: 'comprado', updatedAt: now.toISOString() };
            if (suggested) {
              sale.complementsOffered = [...new Set([...(sale.complementsOffered || []), suggested.name])].slice(-8);
            }
            return { ...ctx, sale, lastOutreachAt: now.toISOString(), lastPostSale: { orderId: order.id, step: stepNumber } };
          });

          const nextStep = STEPS[stepNumber];
          const nextAt = nextStep
            ? new Date(Math.max(new Date(order.createdAt).getTime() + nextStep.dayOffset * DAY_MS, now.getTime() + DAY_MS))
            : null;
          await prisma.order.update({
            where: { id: order.id },
            data: { postSaleStep: stepNumber, postSaleNextAt: nextAt },
          });

          contactedNow.add(contact.id);
          logger.info(`💌 [POSTSALE] Paso ${stepNumber} enviado a ${contact.name || contact.phone} (pedido #${order.id})`);
          await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
          logger.error(`Error en postventa del pedido #${order.id}:`, err.message);
        }
      }
    } catch (error) {
      logger.error('❌ Error en processPostSales:', error);
    }
  }
}

module.exports = new PostSaleService();

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const wompiService = require('../services/wompiService');
const whatsappService = require('../services/whatsappService');
const ownerAlertService = require('../services/ownerAlertService');
const shippingService = require('../services/shippingService');
const { decrypt } = require('../utils/encryption');
const { formatCOP, formatDisplayPhone, formatWaLink, formatClientDisplayName } = require('../utils/helpers');

const DECLINE_STATUSES = ['DECLINED', 'ERROR', 'VOIDED'];

class WompiController {
  constructor() {
    this._inFlight = new Set();
  }

  async handleWebhook(req, res) {
    const body = req.body || {};

    // 1. Autenticidad ANTES de leer o escribir cualquier dato
    const authentic = await this._isAuthentic(body, req.headers['x-event-checksum']);
    if (!authentic) {
      logger.warn(`🚫 Wompi: webhook con firma inválida rechazado (ip ${req.ip}, evento ${body.event || 'N/D'})`);
      return res.status(401).json({ error: 'Firma inválida' });
    }

    if (body.event !== 'transaction.updated') {
      return res.status(200).json({ received: true });
    }

    const transaction = body.data?.transaction;
    if (!transaction?.id) {
      return res.status(200).json({ received: true, ignored: 'sin transacción' });
    }

    // 2. Idempotencia: Wompi reintenta y puede enviar el mismo evento varias veces
    if (this._inFlight.has(transaction.id)) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    this._inFlight.add(transaction.id);

    try {
      const alreadyProcessed = await prisma.order.findFirst({
        where: { wompiTransactionId: transaction.id },
        select: { id: true },
      });
      if (alreadyProcessed) {
        logger.info(`ℹ️ Wompi: transacción ${transaction.id} ya procesada (orden ${alreadyProcessed.id})`);
        return res.status(200).json({ received: true, duplicate: true });
      }

      // 3. Identificar la venta
      const reference = await this._resolveReference(transaction, body.environment);

      if (reference?.startsWith('PAY-')) {
        await this._handleCartPayment(reference, transaction);
      } else if (/^\d+$/.test(String(transaction.reference || ''))) {
        await this._handleLegacyOrder(parseInt(transaction.reference, 10), transaction);
      } else if (transaction.status === 'APPROVED') {
        logger.error(`❌ Wompi: pago aprobado ${transaction.id} sin referencia reconocible (${transaction.reference})`);
        await ownerAlertService.onPaymentOrphan({ transaction, reason: 'No se reconoce la referencia ni el link de pago' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error(`Error procesando webhook de Wompi (tx ${transaction.id}):`, error);
      return res.status(500).json({ error: 'Error interno' });
    } finally {
      this._inFlight.delete(transaction.id);
    }
  }

  /**
   * Valida la firma contra todos los secretos de eventos conocidos
   * (variable de entorno y los guardados por sede).
   */
  async _isAuthentic(body, headerChecksum) {
    const secrets = new Set(
      String(process.env.WOMPI_EVENTS_SECRET || '').split(',').map(s => s.trim()).filter(Boolean)
    );

    try {
      const branches = await prisma.branch.findMany({
        where: { OR: [{ wompiEventsSecret: { not: null } }, { wompiIntegritySecret: { not: null } }] },
        select: { id: true, wompiEventsSecret: true, wompiIntegritySecret: true },
      });
      for (const branch of branches) {
        // El secreto de integridad se acepta solo por compatibilidad con configuraciones
        // antiguas donde se guardó ahí el secreto de eventos.
        for (const encrypted of [branch.wompiEventsSecret, branch.wompiIntegritySecret]) {
          if (!encrypted) continue;
          try {
            const value = decrypt(encrypted)?.trim();
            if (value) secrets.add(value);
          } catch (e) {
            logger.warn(`⚠️ Wompi: no se pudo desencriptar un secreto de la sede ${branch.id}`);
          }
        }
      }
    } catch (error) {
      logger.error('Error leyendo secretos de Wompi:', error.message);
    }

    if (!secrets.size) {
      logger.error('❌ Wompi: no hay "Secreto de Eventos" configurado (WOMPI_EVENTS_SECRET o en Configuración). Se rechazan todos los webhooks.');
      return false;
    }

    for (const secret of secrets) {
      if (wompiService.isValidWebhookChecksum(body, secret, headerChecksum)) return true;
    }
    return false;
  }

  /**
   * Las transacciones de links de pago traen una referencia generada por Wompi;
   * nuestra referencia PAY-... vive en el `sku` del link.
   */
  async _resolveReference(transaction, environment) {
    if (String(transaction.reference || '').startsWith('PAY-')) return transaction.reference;
    const linkId = transaction.payment_link_id;
    if (!linkId) return null;

    const link = await wompiService.getPaymentLink(linkId, environment);
    if (link?.sku && String(link.sku).startsWith('PAY-')) return link.sku;

    try {
      const conv = await prisma.conversation.findFirst({
        where: { context: { path: ['sale', 'pendingPayment', 'paymentLinkId'], equals: linkId } },
        select: { context: true },
      });
      const ref = conv?.context?.sale?.pendingPayment?.reference;
      if (ref) return ref;
    } catch (error) {
      logger.warn(`⚠️ Wompi: búsqueda por paymentLinkId falló: ${error.message}`);
    }
    return null;
  }

  async _handleCartPayment(reference, transaction) {
    const convId = parseInt(reference.split('-')[1], 10);
    const conversation = Number.isFinite(convId)
      ? await prisma.conversation.findUnique({ where: { id: convId }, include: { contact: true, branch: true } })
      : null;

    if (!conversation) {
      logger.error(`❌ Wompi: conversación ${convId} no encontrada para ${reference}`);
      if (transaction.status === 'APPROVED') {
        await ownerAlertService.onPaymentOrphan({ transaction, reason: `Conversación ${convId} no encontrada` });
      }
      return;
    }

    const context = conversation.context || {};
    const cartData = context.pendingCarts?.[reference] || null;

    if (transaction.status !== 'APPROVED') {
      logger.info(`ℹ️ Wompi: transacción ${reference} no aprobada (${transaction.status}). No se crea pedido.`);
      if (DECLINE_STATUSES.includes(transaction.status)) {
        const chatId = `${this._cleanPhone(conversation.contact.phone)}@c.us`;
        const declineMsg = `❌ *Pago Rechazado* \n\nHola, tu pago no ha podido ser procesado. Por favor intenta con otro medio o contacta a tu banco.\n\nSi prefieres, también puedes pagar contraentrega 😊`;
        await whatsappService.sendMessage(conversation.branchId, chatId, declineMsg).catch(() => {});
        await ownerAlertService.onPaymentDeclined({
          contact: conversation.contact,
          conversation,
          branchId: conversation.branchId,
          amount: cartData?.amount || (transaction.amount_in_cents || 0) / 100,
          reference,
        });
      }
      return;
    }

    if (!cartData) {
      logger.error(`❌ Wompi: carrito no encontrado para ${reference}`);
      await ownerAlertService.onPaymentOrphan({
        branchId: conversation.branchId,
        transaction,
        reason: `Carrito ${reference} no encontrado (cliente ${this._cleanPhone(conversation.contact.phone)})`,
      });
      return;
    }

    const crmService = require('../services/crmService');
    const { paymentLinkId, ...orderData } = cartData;
    let created;
    try {
      created = await crmService.createOrder({
        ...orderData,
        status: 'PAID',
        paymentMethod: 'WOMPI',
        wompiTransactionId: transaction.id,
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        logger.info(`ℹ️ Wompi: transacción ${transaction.id} ya tenía pedido. No se crea ni se avisa otra vez.`);
        return;
      }
      throw error;
    }

    await crmService.patchContext(convId, (ctx) => {
      const pendingCarts = { ...(ctx.pendingCarts || {}) };
      delete pendingCarts[reference];
      const next = { ...ctx, pendingCarts };
      delete next.pedido;
      return next;
    });

    const order = await prisma.order.findUnique({
      where: { id: created.id },
      include: { branch: true, contact: true, items: { include: { product: true } } },
    });

    const paid = (transaction.amount_in_cents || 0) / 100;
    if (Math.abs(paid - Number(order.amount)) > 1) {
      await ownerAlertService.onPaymentMismatch({
        branchId: order.branchId, contact: order.contact,
        expected: Number(order.amount), paid, transactionId: transaction.id,
      });
    }

    await this._afterApproved(order, transaction, convId);
  }

  async _handleLegacyOrder(orderId, transaction) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { branch: true, contact: true, items: { include: { product: true } } },
    });

    if (!order) {
      logger.warn(`⚠️ Wompi: orden ${orderId} no encontrada`);
      if (transaction.status === 'APPROVED') {
        await ownerAlertService.onPaymentOrphan({ transaction, reason: `Orden ${orderId} no encontrada` });
      }
      return;
    }

    if (transaction.status === 'APPROVED') {
      if (order.status === 'PAID') return;
      try {
        const updated = await prisma.order.updateMany({
          where: {
            id: orderId,
            status: { not: 'PAID' },
            OR: [{ wompiTransactionId: null }, { wompiTransactionId: transaction.id }],
          },
          data: { status: 'PAID', wompiTransactionId: transaction.id },
        });
        if (updated.count === 0) {
          logger.info(`ℹ️ Wompi: orden ${orderId} ya estaba pagada. No se avisa otra vez.`);
          return;
        }
      } catch (error) {
        if (error?.code === 'P2002') {
          logger.info(`ℹ️ Wompi: transacción ${transaction.id} ya estaba registrada. No se avisa otra vez.`);
          return;
        }
        throw error;
      }
      await this._afterApproved(order, transaction, null);
    } else if (DECLINE_STATUSES.includes(transaction.status)) {
      const chatId = `${this._cleanPhone(order.contact.phone)}@c.us`;
      const declineMsg = `❌ *Pago Rechazado* \n\nHola, tu pago por ${formatCOP(order.amount)} no ha podido ser procesado.`;
      await whatsappService.sendMessage(order.branchId, chatId, declineMsg).catch(() => {});
      await ownerAlertService.onPaymentDeclined({
        contact: order.contact, conversation: null, branchId: order.branchId,
        amount: Number(order.amount), reference: String(orderId),
      });
    }
  }

  /**
   * Efectos de un pago aprobado. Cada paso es independiente: si uno falla,
   * los demás se ejecutan igual y el webhook responde 200 (la orden ya quedó registrada).
   */
  async _afterApproved(order, transaction, conversationId) {
    const step = async (name, fn) => {
      try { await fn(); } catch (error) { logger.error(`❌ Wompi post-pago [${name}] orden ${order.id}:`, error.message); }
    };

    await step('stock', async () => {
      const googleSheetsService = require('../services/googleSheetsService');
      for (const item of order.items) {
        const newStock = Math.max(0, item.product.stock - item.quantity);
        await prisma.product.update({
          where: { id: item.product.id },
          data: { stock: newStock, isAvailable: newStock > 0 },
        });
        await googleSheetsService.updateStock(item.product.id, newStock);
      }
    });

    await step('cliente', async () => {
      const chatId = `${this._cleanPhone(order.contact.phone)}@c.us`;
      const customerMsg = `✅ *¡Pago confirmado!* \n\nHola ${order.contact.name || ''}, hemos recibido tu pago por valor de ${formatCOP(order.amount)}. \n\nEstamos preparando tu pedido. Pronto te notificaremos cuando sea despachado. ¡Gracias por confiar en Fantasías! 🌹`;
      await whatsappService.sendMessage(order.branchId, chatId, customerMsg);
    });

    // Métricas antes del aviso al dueño, para que el historial incluya esta compra.
    await step('métricas', async () => {
      const crmService = require('../services/crmService');
      await crmService.recordPurchase(order.contactId, order.amount, conversationId);
      if (conversationId) {
        await crmService.setSaleStage(conversationId, 'comprado', {
          pendingPayment: null,
          lastPurchase: {
            orderId: order.id,
            products: order.items.map(i => i.product.name),
            amount: Number(order.amount),
            at: new Date().toISOString(),
          },
        });
      }
    });

    await step('dueño', async () => {
      const rawPhone = order.contact.phone;
      const displayPhone = formatDisplayPhone(rawPhone);
      const clientName = formatClientDisplayName(order.contact.name, rawPhone);
      const waLink = formatWaLink(rawPhone);
      const historyLine = await ownerAlertService.buyerHistoryLine(order.contactId);
      const itemsList = order.items.map(i => `- ${i.product.name} (x${i.quantity})`).join('\n');
      const subtotal = order.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
      const shippingFee = Number(order.amount) - subtotal;
      const shippingLine = shippingFee > 0
        ? `🛍️ *Productos:* ${formatCOP(subtotal)}\n🚚 *${shippingService.getShipping(order.shippingCity).label}:* ${formatCOP(shippingFee)}\n`
        : '';
      const extraNotes = String(order.notes || '').split(' | ').filter(n => n && !/^Env[ií]o /.test(n)).join(' | ');
      const neighborhoodInfo = order.contact.neighborhood ? `🏘️ *Barrio:* ${order.contact.neighborhood}\n` : '';
      const deliveryPhone = formatDisplayPhone(order.contact.deliveryPhone);
      const hasAddress = order.shippingAddress && order.shippingAddress !== 'Por confirmar';
      const hasCity = order.shippingCity && order.shippingCity !== 'Por confirmar';
      const addressWarning = (!hasAddress || !hasCity)
        ? `\n⚠️ *DIRECCIÓN PENDIENTE DE CONFIRMACIÓN — CONTACTAR AL CLIENTE PARA OBTENER DIRECCIÓN COMPLETA*\n`
        : '';
      const notificationMsg = `✅ *¡CLIENTE YA PAGÓ VÍA WOMPI!* ✅\n\n` +
        `🧾 *Pedido:* #${order.id}\n` +
        `${shippingLine}` +
        `💰 *Total pagado:* ${formatCOP(order.amount)}\n` +
        `👤 *Cliente:* ${clientName}\n` +
        `📱 *WhatsApp:* ${displayPhone}\n` +
        `${waLink ? `💬 *Abrir chat:* ${waLink}\n` : ''}` +
        `${historyLine ? `${historyLine}\n` : ''}` +
        `📞 *Teléfono para entrega:* ${deliveryPhone}\n` +
        `🏪 *Sucursal:* ${order.branch.name} (${order.branch.city})\n\n` +
        `📦 *Productos:*\n${itemsList}\n` +
        `${extraNotes ? `⚠️ *${extraNotes}*\n` : ''}\n` +
        `📍 *DIRECCIÓN DE ENVÍO:*\n` +
        `${hasAddress ? order.shippingAddress : '❌ NO PROPORCIONADA — CONTACTAR AL CLIENTE'}\n` +
        `🏙️ *CIUDAD:* ${hasCity ? order.shippingCity : '❌ NO PROPORCIONADA — CONTACTAR AL CLIENTE'}\n` +
        `${neighborhoodInfo}` +
        `${addressWarning}` +
        `💳 *Ref Wompi:* ${transaction.id}\n\n` +
        `🚀 *ACCIÓN REQUERIDA:* Preparar despacho inmediato`;
      const sent = await whatsappService.notifyPhone(order.branchId, notificationMsg);
      const crmService = require('../services/crmService');
      await crmService.markOwnerNotified(order.id, !!sent);
    });

    await step('postventa', async () => {
      const postSaleService = require('../services/postSaleService');
      await postSaleService.schedule(order.id);
    });
  }

  _cleanPhone(phone) {
    return String(phone || '').replace(/@[a-z.]+$/i, '');
  }
}

module.exports = new WompiController();

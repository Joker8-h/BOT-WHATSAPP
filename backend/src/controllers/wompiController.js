const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const wompiService = require('../services/wompiService');
const whatsappService = require('../services/whatsappService');
const { decrypt } = require('../utils/encryption');
const { formatCOP } = require('../utils/helpers');

class WompiController {
  async handleWebhook(req, res) {
    const data = req.body;
    
    // 1. Validar que sea un evento de transacción
    if (data.event !== 'transaction.updated') {
      return res.status(200).json({ received: true });
    }

    const transaction = data.data.transaction;
    const reference = transaction.reference;

    try {
      let order = null;
      let orderId = null;

      // --- LOGICA DE REFERENCIA DUAL ---
      if (reference.startsWith('PAY-')) {
        // Nueva lógica: El pedido no existe en DB aún, está en el context de la conversación
        const [,, convIdStr] = reference.split('-');
        const convId = parseInt(convIdStr);

        const conversation = await prisma.conversation.findUnique({
          where: { id: convId },
          include: { contact: true, branch: true }
        });

        if (!conversation) {
          logger.error(`❌ Wompi: Conversación ${convId} no encontrada para referencia ${reference}`);
          return res.status(404).json({ error: 'Conversación no encontrada' });
        }

        const context = conversation.context || {};
        const cartData = context.pendingCarts ? context.pendingCarts[reference] : null;

        if (!cartData && transaction.status === 'APPROVED') {
          logger.error(`❌ Wompi: Datos de carrito no encontrados en contexto para ${reference}`);
          return res.status(404).json({ error: 'Datos de carrito no encontrados' });
        }

        // Si ya está aprobado, creamos la orden en este momento
        if (transaction.status === 'APPROVED') {
          const crmService = require('../services/crmService');
          order = await crmService.createOrder({
            ...cartData,
            status: 'PAID'
          });
          orderId = order.id;
          
          // Re-obtener la orden con sus relaciones para las notificaciones
          order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { branch: true, contact: true, items: { include: { product: true } } }
          });

          // Limpiar el carrito del contexto
          delete context.pendingCarts[reference];
          await prisma.conversation.update({
            where: { id: convId },
            data: { context }
          });
        } else {
          // Si fue rechazado o error, no creamos nada en la DB (opcional)
          logger.info(`ℹ️ Wompi: Transacción ${reference} no aprobada (${transaction.status}). No se crea pedido.`);
          
          if (transaction.status === 'DECLINED') {
            const chatId = `${conversation.contact.phone}@c.us`;
            const declineMsg = `❌ *Pago Rechazado* \n\nHola, tu pago no ha podido ser procesado. Por favor intenta con otro medio o contacta a tu banco.`;
            await whatsappService.sendMessage(conversation.branchId, chatId, declineMsg);
          }
          return res.status(200).json({ success: true });
        }

      } else {
        // Lógica antigua: La orden ya existe en PENDING
        orderId = parseInt(reference);
        order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { branch: true, contact: true, items: { include: { product: true } } }
        });

        if (!order) {
          logger.warn(`⚠️ Wompi: Orden ${orderId} no encontrada`);
          return res.status(404).json({ error: 'Orden no encontrada' });
        }
      }

      // 3. Validar Checksum de seguridad
      const masterBranch = await prisma.branch.findUnique({ where: { id: 1 } });
      const integritySecret = decrypt(masterBranch.wompiIntegritySecret);
      
      if (!wompiService.isValidWebhookChecksum(data, integritySecret)) {
        logger.error(`❌ Wompi: Checksum inválido para referencia ${reference}`);
        return res.status(403).json({ error: 'Firma inválida' });
      }

      // 4. Procesar el estado de la transacción (Solo para lógica antigua, la nueva ya creó la orden como PAID)
      const status = transaction.status;
      
      if (status === 'APPROVED') {
        if (!reference.startsWith('PAY-')) {
          await prisma.order.update({
            where: { id: orderId },
            data: { status: 'PAID', wompiTransactionId: transaction.id }
          });
        }

        // DESCONTAR STOCK Y NOTIFICAR (Compartido para ambos flujos)
        const googleSheetsService = require('../services/googleSheetsService');
        for (const item of order.items) {
          const product = item.product;
          const newStock = Math.max(0, product.stock - item.quantity);
          await prisma.product.update({
            where: { id: product.id },
            data: { stock: newStock, isAvailable: newStock > 0 }
          });
          await googleSheetsService.updateStock(product.id, newStock);
        }

        // NOTIFICAR AL CLIENTE
        const chatId = `${order.contact.phone}@c.us`;
        const customerMsg = `✅ *¡Pago confirmado!* \n\nHola ${order.contact.name || ''}, hemos recibido tu pago por valor de ${formatCOP(order.amount)}. \n\nEstamos preparando tu pedido. Pronto te notificaremos cuando sea despachado. ¡Gracias por confiar en Fantasías! 🌹`;
        await whatsappService.sendMessage(order.branchId, chatId, customerMsg);

        // NOTIFICAR AL GRUPO DE DESPACHOS
        const itemsList = order.items.map(i => `- ${i.product.name} (x${i.quantity})`).join('\n');
        const notificationMsg = `🔔 *¡NUEVA VENTA PAGADA!* 🔔\n\n` +
                                `💰 *Total:* ${formatCOP(order.amount)}\n` +
                                `📍 *Sucursal:* ${order.branch.name} (${order.branch.city})\n` +
                                `👤 *Cliente:* ${order.contact.name || order.contact.phone}\n` +
                                `📦 *Productos:*\n${itemsList}\n\n` +
                                `🏠 *DIRECCIÓN DE ENVÍO:* \n${order.shippingAddress || 'No especificada'}\n` +
                                `City: ${order.shippingCity || 'No especificada'}\n\n` +
                                `💳 *Ref Wompi:* ${transaction.id}\n\n` +
                                `🚀 ¡A preparar para despacho!`;
        
        await whatsappService.notifyGroup(order.branchId, notificationMsg);
      } else if (status === 'DECLINED' && !reference.startsWith('PAY-')) {
        const chatId = `${order.contact.phone}@c.us`;
        const declineMsg = `❌ *Pago Rechazado* \n\nHola, tu pago por ${formatCOP(order.amount)} no ha podido ser procesado.`;
        await whatsappService.sendMessage(order.branchId, chatId, declineMsg);
      }

      return res.status(200).json({ success: true });

    } catch (error) {
      logger.error(`Error procesando webhook de Wompi para orden ${orderId}:`, error);
      return res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new WompiController();

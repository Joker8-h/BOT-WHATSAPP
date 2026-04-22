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
    const orderId = parseInt(transaction.reference);

    try {
      // 2. Buscar la orden para obtener la sucursal y validar
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { 
          branch: true,
          contact: true,
          items: { include: { product: true } }
        }
      });

      if (!order) {
        logger.warn(`⚠️ Wompi: Orden ${orderId} no encontrada`);
        return res.status(404).json({ error: 'Orden no encontrada' });
      }

      // 3. Validar Checksum de seguridad
      const integritySecret = decrypt(order.branch.wompiIntegritySecret);
      if (!wompiService.isValidWebhookChecksum(data, integritySecret)) {
        logger.error(`❌ Wompi: Checksum inválido para orden ${orderId}`);
        return res.status(403).json({ error: 'Firma inválida' });
      }

      // 4. Procesar el estado de la transacción
      const status = transaction.status; // 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'
      
      logger.info(`💳 Wompi: Transacción ${transaction.id} para orden ${orderId} está ${status}`);

      if (status === 'APPROVED') {
        // ACTUALIZAR ORDEN
        await prisma.order.update({
          where: { id: orderId },
          data: { 
            status: 'PAID',
            wompiTransactionId: transaction.id
          }
        });

        // DESCONTAR STOCK Y ACTUALIZAR EXCEL (SI APLICA)
        const googleSheetsService = require('../services/googleSheetsService');
        for (const item of order.items) {
          const product = item.product;
          const newStock = Math.max(0, product.stock - item.quantity);
          
          // 1. Actualizar DB
          await prisma.product.update({
            where: { id: product.id },
            data: { 
              stock: newStock,
              isAvailable: newStock > 0
            }
          });

          // 2. Intentar actualizar Google Sheets (Dos-Vías)
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
                                `🏙️ *Ciudad:* ${order.shippingCity || 'No especificada'}\n\n` +
                                `💳 *Ref Wompi:* ${transaction.id}\n\n` +
                                `🚀 ¡A preparar para despacho!`;
        
        await whatsappService.notifyGroup(order.branchId, notificationMsg);
      } else if (status === 'DECLINED') {
        // Opcional: Notificar al cliente que el pago fue rechazado
        const chatId = `${order.contact.phone}@c.us`;
        const declineMsg = `❌ *Pago Rechazado* \n\nHola, tu pago por ${formatCOP(order.amount)} no ha podido ser procesado por Wompi. Por favor intenta con otro medio o contacta a tu banco.`;
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

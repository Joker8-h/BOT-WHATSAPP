// ─────────────────────────────────────────────────────────
//  CONTROLLER: Pagos Wompi — Webhooks
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const whatsappService = require('../services/whatsappService');
const { formatCOP } = require('../utils/helpers');
const logger = require('../utils/logger');

class PaymentController {
  /**
   * Webhook de Wompi — procesa eventos de pago exitosos
   */
  async handleWebhook(req, res) {
    try {
      const { data, event, signature, timestamp } = req.body;
      
      if (event !== 'transaction.updated') {
        return res.json({ received: true });
      }

      const transaction = data.transaction;
      const { reference, status, amount_in_cents, id: transactionId } = transaction;

      if (status !== 'APPROVED') {
        logger.info(`Transacción Wompi ${transactionId} con estado: ${status}`);
        return res.json({ received: true });
      }

      // 1. Buscar la orden por referencia
      const order = await prisma.order.findUnique({
        where: { id: reference },
        include: { 
          branch: true, 
          contact: true,
          items: { include: { product: true } }
        }
      });

      if (!order) {
        logger.error(`Orden no encontrada para referencia Wompi: ${reference}`);
        return res.status(404).json({ error: 'Order not found' });
      }

      // 2. Evitar doble procesamiento
      if (order.status === 'PAID') {
        return res.json({ success: true, message: 'Already processed' });
      }

      // 3. PROCESAR VENTA EXITOSA
      await prisma.$transaction(async (tx) => {
        // Actualizar Orden
        await tx.order.update({
          where: { id: order.id },
          data: { 
            status: 'PAID', 
            wompiTransactionId: transactionId,
            paidAt: new Date()
          }
        });

        // RESTAR STOCK AUTOMÁTICAMENTE
        for (const item of order.items) {
          if (item.product) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { decrement: item.quantity } }
            });
            logger.info(`📉 Stock descontado: ${item.product.name} (-${item.quantity}) en sede ${order.branchId}`);
          }
        }
      });

      // 4. NOTIFICACIONES
      
      // A. Al Cliente
      const productsList = order.items.map(i => `- ${i.product.name} (x${i.quantity})`).join('\n');
      const confirmMsg = `✅ *¡Pago Recibido Exitosamente!*\n\nGracias por tu compra en *Fantasías*.\n\n📦 *Pedido:*\n${productsList}\n\n💰 Total: ${formatCOP(order.amount)}\n🚚 Prepararemos tu envío discreto de inmediato.\n\n¡Gracias por confiar en nosotros! 🔥`;
      await whatsappService.sendMessage(order.branchId, order.contact.phone + '@c.us', confirmMsg);

      // B. AL GRUPO DE LA SUCURSAL (DESPACHO)
      const groupMsg = `🚨 *¡NUEVA VENTA REALIZADA!* 🚨\n\n` +
        `Sede: *${order.branch.name}*\n` +
        `Cliente: ${order.contact.name} (${order.contact.phone})\n` +
        `Productos:\n${productsList}\n` +
        `Total: ${formatCOP(order.amount)}\n\n` +
        `📍 *DIRECCIÓN DE ENVÍO:*\n${order.contact.address || 'No especificada, contactar cliente'}\n` +
        `${order.contact.city || ''}\n\n` +
        `⚠️ *Acción:* Preparar despacho de inmediato.`;
      
      await whatsappService.notifyGroup(order.branchId, groupMsg);

      res.json({ success: true });
    } catch (error) {
      logger.error('Error procesando webhook de Wompi:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Página de éxito de pago
   */
  async paymentSuccess(req, res) {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="UTF-8"><title>¡Pago Exitoso! - Fantasías</title>
      <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#1a0a2e,#2d1b4e);color:white;margin:0}
      .card{text-align:center;padding:3rem;border-radius:20px;background:rgba(255,255,255,0.1);backdrop-filter:blur(10px)}
      h1{font-size:2rem}p{opacity:0.8;font-size:1.1rem}</style></head>
      <body><div class="card">
        <h1>✅ ¡Pago exitoso!</h1>
        <p>Gracias por tu compra en <strong>Fantasías</strong>.</p>
        <p>Recibirás confirmación por WhatsApp.</p>
        <p style="margin-top:2rem;font-size:0.9rem;opacity:0.6">Puedes cerrar esta ventana</p>
      </div></body></html>
    `);
  }

  /**
   * Página de pago cancelado
   */
  async paymentCancel(req, res) {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="UTF-8"><title>Pago Cancelado - Fantasías</title>
      <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#2e0a0a,#4e1b1b);color:white;margin:0}
      .card{text-align:center;padding:3rem;border-radius:20px;background:rgba(255,255,255,0.1);backdrop-filter:blur(10px)}
      h1{font-size:2rem}p{opacity:0.8;font-size:1.1rem}</style></head>
      <body><div class="card">
        <h1>❌ Pago cancelado</h1>
        <p>No te preocupes, no se realizó ningún cargo.</p>
        <p>Escríbenos por WhatsApp si necesitas ayuda 😊</p>
      </div></body></html>
    `);
  }
}

module.exports = new PaymentController();

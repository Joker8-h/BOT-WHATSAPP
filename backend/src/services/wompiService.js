const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { decrypt } = require('../utils/encryption');

class WompiService {
  constructor() {
    // La URL base se determinará dinámicamente según la llave detectada
    this.sandboxUrl = 'https://sandbox.wompi.co/v1';
    this.productionUrl = 'https://api.wompi.co/v1';
  }

  /**
   * Genera un link de pago dinámico para una sucursal específica
   */
  async generatePaymentLink({ branchId, amount, name, description, reference }) {
    try {
      // 1. Obtener credenciales de la sucursal MAESTRA (Sucursal 1)
      const masterBranchId = 1;
      const branch = await prisma.branch.findUnique({
        where: { id: masterBranchId },
        select: { wompiPrivateKey: true, wompiPublicKey: true, wompiIntegritySecret: true }
      });

      if (!branch || !branch.wompiPrivateKey) {
        throw new Error(`La sucursal maestra (${masterBranchId}) no tiene configurado Wompi`);
      }

      // Desencriptar llave privada y determinar URL
      const privateKey = decrypt(branch.wompiPrivateKey).trim();
      const isProd = privateKey.startsWith('prv_prod_');
      const activeUrl = isProd ? this.productionUrl : this.sandboxUrl;

      logger.info(`💳 Generando link en ambiente: ${isProd ? 'PRODUCCIÓN' : 'SANDBOX'}`);

      // 2. Crear el link de pago en Wompi
      // Nota: El monto en Wompi se envía en centavos
      const amountInCents = Math.round(parseFloat(amount) * 100);

      const payload = {
        name,
        description,
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: amountInCents,
        sku: reference,
        redirect_url: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/payment-status` : undefined
      };

      const response = await axios.post(`${activeUrl}/payment_links`, payload, {
        headers: {
          'Authorization': `Bearer ${privateKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 segundos de timeout
      });

      const paymentLinkData = response.data.data;
      const checkoutUrl = `https://checkout.wompi.co/l/${paymentLinkData.id}`;

      logger.info(`💳 Link de Wompi generado para sucursal ${branchId}: ${checkoutUrl}`);
      
      return {
        id: paymentLinkData.id,
        url: checkoutUrl
      };

    } catch (error) {
      logger.error(`Error generando link de Wompi para sucursal ${branchId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Genera la firma de integridad para validación (si se requiere en checkout directo)
   */
  generateIntegritySignature(reference, amountInCents, currency, secret) {
    const chain = `${reference}${amountInCents}${currency}${secret}`;
    return crypto.createHash('sha256').update(chain).digest('hex');
  }

  /**
   * Valida el checksum de un evento de webhook de Wompi.
   * Las `properties` apuntan a campos del objeto `data` del evento (no del body completo),
   * y el secreto es el "Secreto de Eventos" (prod_events_... / test_events_...).
   * @param {Object} body - El body completo del webhook
   * @param {string} secret - Secreto de eventos
   * @param {string} [headerChecksum] - Valor del header X-Event-Checksum
   */
  isValidWebhookChecksum(body, secret, headerChecksum = null) {
    try {
      if (!secret || !body || typeof body !== 'object') return false;
      const signature = body.signature || {};
      const received = String(signature.checksum || headerChecksum || '').trim().toLowerCase();
      const properties = Array.isArray(signature.properties) ? signature.properties : null;
      const timestamp = body.timestamp ?? signature.timestamp;
      if (!received || !properties?.length || timestamp === undefined || timestamp === null) return false;

      let concatenated = '';
      for (const property of properties) {
        const value = String(property).split('.').reduce((obj, key) => obj?.[key], body.data);
        if (value === undefined || value === null) return false;
        concatenated += String(value);
      }

      const generated = crypto
        .createHash('sha256')
        .update(`${concatenated}${timestamp}${secret}`)
        .digest('hex');

      const a = Buffer.from(generated, 'utf8');
      const b = Buffer.from(received, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (error) {
      logger.error('Error validando checksum de Wompi:', error);
      return false;
    }
  }

  /**
   * Consulta un link de pago (endpoint público de Wompi) para recuperar su `sku`,
   * donde guardamos nuestra referencia PAY-<conversationId>-<timestamp>.
   */
  async getPaymentLink(paymentLinkId, environment = 'prod') {
    if (!paymentLinkId) return null;
    const base = environment === 'test' ? this.sandboxUrl : this.productionUrl;
    try {
      const response = await axios.get(`${base}/payment_links/${encodeURIComponent(paymentLinkId)}`, { timeout: 8000 });
      return response.data?.data || null;
    } catch (error) {
      logger.warn(`⚠️ Wompi: no se pudo consultar el link ${paymentLinkId}: ${error.response?.status || error.message}`);
      return null;
    }
  }
}

module.exports = new WompiService();

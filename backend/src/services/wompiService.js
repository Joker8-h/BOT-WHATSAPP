const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { decrypt } = require('../utils/encryption');

class WompiService {
  constructor() {
    this.baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://api.wompi.co/v1' 
      : 'https://sandbox.wompi.co/v1';
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

      // Desencriptar llave privada
      const privateKey = decrypt(branch.wompiPrivateKey);

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

      const response = await axios.post(`${this.baseUrl}/payment_links`, payload, {
        headers: {
          'Authorization': `Bearer ${privateKey.trim()}`,
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
   * Valida el checksum de un evento de webhook de Wompi
   * @param {Object} data - El body completo del webhook
   * @param {string} secret - El secret (usualmente el integrity secret si no hay uno específico de eventos)
   */
  isValidWebhookChecksum(data, secret) {
    try {
      const { signature, timestamp } = data;
      if (!signature || !signature.checksum || !signature.properties) return false;

      // 1. Reconstruir la cadena de propiedades según el orden que envía Wompi
      let concatenated = '';
      for (const property of signature.properties) {
        // Acceso anidado dinámico: de "data.transaction.id" obtener el valor real
        const value = property.split('.').reduce((obj, key) => obj?.[key], data);
        concatenated += value;
      }

      // 2. Añadir timestamp y secret
      const chain = `${concatenated}${timestamp}${secret}`;
      
      // 3. Generar hash y comparar
      const generatedChecksum = crypto.createHash('sha256').update(chain).digest('hex');
      
      return generatedChecksum === signature.checksum;
    } catch (error) {
      logger.error('Error validando checksum de Wompi:', error);
      return false;
    }
  }
}

module.exports = new WompiService();

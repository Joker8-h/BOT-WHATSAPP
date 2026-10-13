const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { decrypt, encrypt } = require('../utils/encryption');

class WompiService {
  constructor() {
    this.sandboxUrl = 'https://sandbox.wompi.co/v1';
    this.productionUrl = process.env.WOMPI_API_URL || 'https://production.wompi.co/v1';
  }

  /**
   * Resuelve credenciales de Wompi de manera robusta:
   * 1. Prioridad: Variables de entorno (WOMPI_PRIVATE_KEY, WOMPI_PUBLIC_KEY, etc.)
   * 2. Sucursal en Base de Datos
   * Si las llaves están en entorno pero la BD no las tiene, sincroniza automáticamente la BD.
   */
  async getCredentials(branchId = 1) {
    let privateKey = process.env.WOMPI_PRIVATE_KEY?.trim() || null;
    let publicKey = process.env.WOMPI_PUBLIC_KEY?.trim() || null;
    let integritySecret = process.env.WOMPI_INTEGRITY_SECRET?.trim() || null;
    let eventsSecret = process.env.WOMPI_EVENTS_SECRET?.trim() || null;

    // Merge campo por campo: lo que falte en ENV se completa desde la BD (no se ignora todo)
    if (!privateKey || !publicKey || !integritySecret || !eventsSecret) {
      try {
        const masterBranchId = branchId ? parseInt(branchId) : 1;
        const branch = await prisma.branch.findUnique({
          where: { id: masterBranchId },
          select: { wompiPrivateKey: true, wompiPublicKey: true, wompiIntegritySecret: true, wompiEventsSecret: true }
        });

        if (branch) {
          if (!privateKey && branch.wompiPrivateKey) privateKey = decrypt(branch.wompiPrivateKey)?.trim() || null;
          if (!publicKey && branch.wompiPublicKey) publicKey = decrypt(branch.wompiPublicKey)?.trim() || null;
          if (!integritySecret && branch.wompiIntegritySecret) integritySecret = decrypt(branch.wompiIntegritySecret)?.trim() || null;
          if (!eventsSecret && branch.wompiEventsSecret) eventsSecret = decrypt(branch.wompiEventsSecret)?.trim() || null;
        }
      } catch (err) {
        logger.warn(`⚠️ Error leyendo credenciales Wompi de BD: ${err.message}`);
      }
    }
    if (privateKey) {
      // Si están en variables de entorno, sincronizar en BD en segundo plano
      this._syncEnvCredentialsToDb().catch(() => {});
    }

    return { privateKey, publicKey, integritySecret, eventsSecret };
  }

  async _syncEnvCredentialsToDb() {
    try {
      const pKey = process.env.WOMPI_PRIVATE_KEY?.trim();
      if (!pKey) return;
      const b1 = await prisma.branch.findUnique({ where: { id: 1 }, select: { wompiPrivateKey: true } });
      if (!b1?.wompiPrivateKey) {
        const pubKey = process.env.WOMPI_PUBLIC_KEY?.trim();
        const intSec = process.env.WOMPI_INTEGRITY_SECRET?.trim();
        const evSec = process.env.WOMPI_EVENTS_SECRET?.trim();
        const data = {};
        if (pKey) data.wompiPrivateKey = encrypt(pKey);
        if (pubKey) data.wompiPublicKey = encrypt(pubKey);
        if (intSec) data.wompiIntegritySecret = encrypt(intSec);
        if (evSec) data.wompiEventsSecret = encrypt(evSec);

        await prisma.branch.update({
          where: { id: 1 },
          data
        });
        logger.info('💳 Credenciales de Wompi de variables de entorno persistidas en la sede 1 de la BD (sin tocar otras sedes)');
      }
    } catch (_) {}
  }

  /**
   * Genera un link de pago dinámico para una sucursal específica
   */
  async generatePaymentLink({ branchId, amount, name, description, reference }) {
    try {
      const creds = await this.getCredentials(branchId);
      const privateKey = creds.privateKey;

      if (!privateKey) {
        throw new Error(`Wompi no está configurado (falta WOMPI_PRIVATE_KEY en variables de entorno o BD)`);
      }

      // Determinar URL base
      const isProd = privateKey.startsWith('prv_prod_');
      const activeUrl = isProd ? (process.env.WOMPI_API_URL || this.productionUrl) : this.sandboxUrl;

      logger.info(`💳 Generando link de pago en ambiente: ${isProd ? 'PRODUCCIÓN' : 'SANDBOX'} (${activeUrl})`);

      // Monto en centavos
      const amountInCents = Math.round(parseFloat(amount) * 100);

      const payload = {
        name,
        description,
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: amountInCents,
        sku: reference,
        redirect_url: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL.replace(/\/+$/, '')}/payment-status` : undefined
      };
      if (!payload.redirect_url) {
        logger.warn('⚠️ Wompi: FRONTEND_URL no configurado — el link quedará sin redirect_url');
      }

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
    const env = String(environment || 'prod').toLowerCase();
    const isTest = ['test', 'sandbox', 'test_sandbox'].includes(env);
    const bases = isTest ? [this.sandboxUrl, this.productionUrl] : [this.productionUrl, this.sandboxUrl];
    // Probar con auth (algunas cuentas exigen Bearer) y sin auth como fallback
    const privateKey = process.env.WOMPI_PRIVATE_KEY?.trim();
    for (const base of bases) {
      for (const headers of (privateKey ? [{ Authorization: `Bearer ${privateKey}` }] : [{}]).concat([{}])) {
        try {
          const response = await axios.get(`${base}/payment_links/${encodeURIComponent(paymentLinkId)}`, { headers, timeout: 8000 });
          if (response.data?.data) return response.data.data;
        } catch (error) {
          if (error.response?.status === 401 || error.response?.status === 404) continue;
          logger.warn(`⚠️ Wompi: no se pudo consultar el link ${paymentLinkId} en ${base}: ${error.response?.status || error.message}`);
          break;
        }
      }
    }
    return null;
  }
}

module.exports = new WompiService();

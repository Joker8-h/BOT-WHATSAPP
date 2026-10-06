// ─────────────────────────────────────────────────────────
//  SERVICE: Alertas al dueño — avisos accionables por WhatsApp
//  al teléfono de notificación de cada sede.
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { formatCOP, formatDisplayPhone, formatWaLink, formatClientDisplayName, cleanPhoneDigits } = require('../utils/helpers');
const { normalizeText, containsPhrase } = require('../ai/salesKnowledge');
const { OBJECTION_LABELS } = require('../ai/saleState');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BOGOTA_OFFSET_HOURS = 5;

const ALERT_TYPES = {
  escalation: { title: '🙋 CLIENTE PIDE ATENCIÓN HUMANA', cooldownHours: 0.5 },
  complaint: { title: '😠 POSIBLE QUEJA O CLIENTE MOLESTO', cooldownHours: 6 },
  hesitation: { title: '💸 VENTA GRANDE EN DUDA', cooldownHours: 24 },
  vip_back: { title: '⭐ CLIENTE VIP ESCRIBIENDO', cooldownHours: 24 },
  link_abandoned: { title: '⏳ LINK DE PAGO SIN PAGAR', cooldownHours: 48 },
  payment_declined: { title: '❌ PAGO RECHAZADO', cooldownHours: 1 },
  payment_orphan: { title: '🚨 PAGO RECIBIDO SIN PEDIDO', cooldownHours: 0 },
  payment_mismatch: { title: '🚨 MONTO PAGADO DISTINTO AL PEDIDO', cooldownHours: 0 },
  ai_down: { title: '🤖 SOFÍA TIENE PROBLEMAS PARA RESPONDER', cooldownHours: 1 },
  admin_registered: { title: '🔐 NUEVO ADMIN REGISTRADO', cooldownHours: 0 },
  daily_summary: { title: '📊 RESUMEN DEL DÍA', cooldownHours: 0 },
};

// Frases que casi siempre indican un reclamo, sin importar si ya compró.
const COMPLAINT_PHRASES = [
  'estafa', 'estafador', 'estafadores', 'ladron', 'ladrones', 'robo', 'me robaron',
  'queja', 'reclamo', 'demanda', 'denuncia', 'denunciar', 'superintendencia', 'abogado',
  'devolucion', 'devolver el dinero', 'reembolso', 'me devuelven', 'quiero mi plata', 'quiero mi dinero',
  'no ha llegado', 'no me ha llegado', 'no me llego', 'nunca llego', 'todavia no llega', 'aun no llega',
  'pesimo', 'pesima', 'mal servicio', 'mala atencion', 'mentirosos', 'me enganaron', 'enganados',
  'que falta de respeto', 'no respondieron', 'nadie responde', 'nadie me responde',
];
// Frases que solo son queja si el cliente ya compró (antes de comprar son dudas normales).
const POST_PURCHASE_PHRASES = [
  'no funciona', 'no sirve', 'no prende', 'no enciende', 'danado', 'danada', 'defectuoso', 'defectuosa',
  'llego roto', 'llego rota', 'llego mal', 'vino mal', 'me llego otro', 'no es lo que pedi',
];

class OwnerAlertService {
  constructor() {
    this.whatsappService = null;
    this._memoryCooldowns = new Map();
  }

  setServices(whatsappService) {
    this.whatsappService = whatsappService;
  }

  // ── Configuración ─────────────────────────────────────
  _isEnabled(type) {
    const global = String(process.env.OWNER_ALERTS || 'on').toLowerCase();
    if (['off', 'false', '0', 'no'].includes(global)) return false;
    const disabled = String(process.env.OWNER_ALERTS_DISABLED || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return !disabled.includes(type);
  }

  get highValueThreshold() {
    return Number(process.env.OWNER_ALERT_HIGH_VALUE) || 150000;
  }

  get vipThreshold() {
    return Number(process.env.OWNER_ALERT_VIP_SPENT) || 150000;
  }

  // ── Utilidades de formato ─────────────────────────────
  _cleanPhone(phone) {
    return cleanPhoneDigits(phone);
  }

  clientLabel(contact) {
    const rawPhone = contact?.phone;
    const phoneDisplay = formatDisplayPhone(rawPhone);
    const nameDisplay = formatClientDisplayName(contact?.name, rawPhone);
    const link = formatWaLink(rawPhone);
    const linkLine = link ? `\n💬 *Chat directo:* ${link}` : '';
    return `👤 *Cliente:* ${nameDisplay}\n📱 *WhatsApp:* ${phoneDisplay}${linkLine}`;
  }

  _truncate(text, max = 300) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  waLink(phone) {
    return formatWaLink(phone);
  }

  /**
   * Línea de historial para los avisos de venta. Debe llamarse DESPUÉS de
   * registrar la compra, para que cuente la venta actual.
   */
  async buyerHistoryLine(contactId) {
    try {
      const fresh = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { totalPurchases: true, totalSpent: true },
      });
      const purchases = fresh?.totalPurchases || 0;
      if (purchases <= 1) return '🆕 *Cliente nuevo* (primera compra)';
      const vip = this.isVip(fresh) ? ' · ⭐ VIP' : '';
      return `🔁 *Cliente recurrente:* ${purchases}ª compra · total gastado ${formatCOP(fresh.totalSpent || 0)}${vip}`;
    } catch (error) {
      logger.warn(`⚠️ No se pudo leer el historial del contacto ${contactId}: ${error.message}`);
      return '';
    }
  }

  isVip(contact) {
    return (contact?.totalPurchases || 0) >= 2 || Number(contact?.totalSpent || 0) >= this.vipThreshold;
  }

  // ── Envío con anti-spam ───────────────────────────────
  /**
   * Envía una alerta si el tipo está habilitado y no se envió una igual dentro del cooldown.
   * El cooldown se guarda en el contexto de la conversación (sobrevive reinicios) o, si no
   * hay conversación, en memoria por sede.
   */
  async send(branchId, type, body, { conversationId = null, key = type, cooldownHours } = {}) {
    try {
      if (!branchId || !this.whatsappService || !this._isEnabled(type)) return false;
      const def = ALERT_TYPES[type] || { title: '🔔 ALERTA', cooldownHours: 1 };
      const cooldownMs = (cooldownHours ?? def.cooldownHours) * HOUR;

      if (cooldownMs > 0) {
        const allowed = conversationId
          ? await this._claimConversationSlot(conversationId, key, cooldownMs)
          : this._claimMemorySlot(`${branchId}:${key}`, cooldownMs);
        if (!allowed) return false;
      }

      const message = `🔔 *${def.title}*\n\n${body}`;
      const sent = await this.whatsappService.notifyPhone(branchId, message);
      if (sent) logger.info(`🔔 [OWNER-ALERT] ${type} enviada a sede ${branchId}`);
      return sent;
    } catch (error) {
      logger.error(`Error enviando alerta ${type} a sede ${branchId}:`, error.message);
      return false;
    }
  }

  _claimMemorySlot(key, cooldownMs) {
    const last = this._memoryCooldowns.get(key) || 0;
    if (Date.now() - last < cooldownMs) return false;
    this._memoryCooldowns.set(key, Date.now());
    return true;
  }

  async _claimConversationSlot(conversationId, key, cooldownMs) {
    const crmService = require('./crmService');
    let allowed = false;
    await crmService.patchContext(conversationId, (ctx) => {
      const alerts = { ...(ctx.ownerAlerts || {}) };
      const last = alerts[key] ? new Date(alerts[key]).getTime() : 0;
      if (Date.now() - last < cooldownMs) return null;
      allowed = true;
      alerts[key] = new Date().toISOString();
      return { ...ctx, ownerAlerts: alerts };
    });
    return allowed;
  }

  // ── Detectores sobre mensajes entrantes ───────────────
  detectComplaint(text, { hasPurchased = false } = {}) {
    const norm = normalizeText(text);
    if (!norm) return null;
    const hit = COMPLAINT_PHRASES.find(p => containsPhrase(norm, p))
      || (hasPurchased ? POST_PURCHASE_PHRASES.find(p => containsPhrase(norm, p)) : null);
    return hit || null;
  }

  /**
   * Revisa el mensaje del cliente ANTES de que Sofía responda.
   * `previousMessageAt` es la fecha del mensaje anterior del cliente (antes de este lote).
   */
  async checkIncoming({ contact, conversation, branchId, text, previousMessageAt }) {
    if (!contact || !conversation || !text) return;

    const hasPurchased = (contact.totalPurchases || 0) > 0;
    const complaint = this.detectComplaint(text, { hasPurchased });
    if (complaint) {
      await this.send(branchId, 'complaint',
        `${this.clientLabel(contact)}\n` +
        `🛍️ *Compras previas:* ${contact.totalPurchases || 0}\n\n` +
        `💬 *Escribió:* "${this._truncate(text)}"\n\n` +
        `👉 Sofía ya le está respondiendo, pero conviene que lo atiendas tú personalmente.`,
        { conversationId: conversation.id });
    }

    if (this.isVip(contact)) {
      const gap = previousMessageAt ? Date.now() - new Date(previousMessageAt).getTime() : Infinity;
      if (gap >= 7 * DAY) {
        await this.send(branchId, 'vip_back',
          `${this.clientLabel(contact)}\n` +
          `🛍️ *Compras:* ${contact.totalPurchases || 0} · *Total gastado:* ${formatCOP(contact.totalSpent || 0)}\n\n` +
          `💬 *Escribió:* "${this._truncate(text, 200)}"\n\n` +
          `👉 Es un cliente valioso: un saludo tuyo puede asegurar la recompra.`,
          { conversationId: conversation.id });
      }
    }
  }

  // ── Alertas después de la respuesta de Sofía ──────────
  async onEscalation({ contact, conversation, branchId, body, messageHistory = [] }) {
    const recent = [...messageHistory.filter(m => m.role === 'USER').slice(-2).map(m => m.content), body]
      .filter(Boolean).slice(-3)
      .map(t => `• "${this._truncate(t, 160)}"`).join('\n');
    await this.send(branchId, 'escalation',
      `${this.clientLabel(contact)}\n\n` +
      `💬 *Últimos mensajes:*\n${recent || '(sin texto)'}\n\n` +
      `👉 Sofía pausó el chat. Si nadie responde en 10 minutos, ella lo retoma automáticamente.`,
      { conversationId: conversation?.id });
  }

  /**
   * Cliente con objeción de precio / "lo voy a pensar" sobre productos caros.
   */
  async onSaleUpdate({ contact, conversation, branchId, actions = {}, sale = {} }) {
    const objections = (actions.objections || []).map(o => String(o).toLowerCase());
    const hesitating = objections.some(o => ['precio', 'pensarlo'].includes(o));
    if (!hesitating || !sale.interestProducts?.length) return;

    const catalogService = require('./catalogService');
    const priced = [];
    for (const name of sale.interestProducts.slice(-3)) {
      const product = await catalogService.findProductByName(name, branchId).catch(() => null);
      if (product) priced.push({ name: product.name, price: Number(product.price) || 0 });
    }
    const maxValue = priced.reduce((max, p) => Math.max(max, p.price), 0);
    if (maxValue < this.highValueThreshold) return;

    const objectionText = objections
      .filter(o => ['precio', 'pensarlo'].includes(o))
      .map(o => OBJECTION_LABELS?.[o] || o).join(', ');
    const list = priced.map(p => `• ${p.name} — ${formatCOP(p.price)}`).join('\n');

    await this.send(branchId, 'hesitation',
      `${this.clientLabel(contact)}\n\n` +
      `🛍️ *Le interesa:*\n${list}\n\n` +
      `🤔 *Objeción:* ${objectionText}\n\n` +
      `👉 Sofía está manejando la objeción. Si quieres cerrarla tú, un detalle o un mensaje personal puede hacer la diferencia.`,
      { conversationId: conversation?.id });
  }

  // ── Pagos ─────────────────────────────────────────────
  async onLinkAbandoned({ contact, conversation, branchId, pending }) {
    const hours = pending?.sentAt ? Math.round((Date.now() - new Date(pending.sentAt).getTime()) / HOUR) : null;
    await this.send(branchId, 'link_abandoned',
      `${this.clientLabel(contact)}\n\n` +
      `💰 *Monto:* ${formatCOP(pending?.amount || 0)}\n` +
      `📦 *Productos:* ${(pending?.products || []).join(', ') || 'N/D'}\n` +
      `${hours !== null ? `⏱️ *Link enviado hace:* ${hours} h\n` : ''}\n` +
      `👉 Sofía le envió un recordatorio. Una llamada o mensaje tuyo suele cerrar estas ventas.`,
      { conversationId: conversation?.id, key: `link_abandoned:${pending?.reference || 'x'}` });
  }

  async onPaymentDeclined({ contact, conversation, branchId, amount, reference }) {
    await this.send(branchId, 'payment_declined',
      `${this.clientLabel(contact)}\n\n` +
      `💰 *Monto:* ${formatCOP(amount || 0)}\n` +
      `🧾 *Referencia:* ${reference}\n\n` +
      `👉 El cliente quería pagar. Ofrécele otro medio o contraentrega antes de que se enfríe.`,
      { conversationId: conversation?.id, key: `payment_declined:${reference}` });
  }

  async onPaymentOrphan({ branchId, transaction, reason }) {
    await this.send(branchId || 1, 'payment_orphan',
      `Wompi confirmó un pago aprobado pero no se pudo asociar a ningún pedido.\n\n` +
      `💰 *Monto:* ${formatCOP((transaction?.amount_in_cents || 0) / 100)}\n` +
      `💳 *Transacción:* ${transaction?.id}\n` +
      `🧾 *Referencia:* ${transaction?.reference}\n` +
      `📧 *Email:* ${transaction?.customer_email || 'N/D'}\n` +
      `❓ *Motivo:* ${reason}\n\n` +
      `👉 Revisa el pago en el panel de Wompi y crea el pedido manualmente.`);
  }

  async onPaymentMismatch({ branchId, contact, expected, paid, transactionId }) {
    await this.send(branchId, 'payment_mismatch',
      `${this.clientLabel(contact)}\n\n` +
      `🧾 *Valor del pedido:* ${formatCOP(expected)}\n` +
      `💰 *Valor pagado:* ${formatCOP(paid)}\n` +
      `💳 *Transacción:* ${transactionId}\n\n` +
      `👉 El pedido se registró igual. Verifica la diferencia antes de despachar.`);
  }

  // ── Sistema ───────────────────────────────────────────
  async onAiFailure({ branchId, reason }) {
    await this.send(branchId, 'ai_down',
      `Sofía no pudo generar respuestas con la IA y está usando mensajes de respaldo.\n\n` +
      `❓ *Detalle:* ${this._truncate(reason, 200)}\n\n` +
      `👉 Revisa el saldo/límite de la API de IA. Mientras tanto, los clientes pueden quedar sin asesoría.`);
  }

  async onAdminRegistered({ branchId, lid, name }) {
    await this.send(branchId, 'admin_registered',
      `Se registró un nuevo acceso de administrador por WhatsApp.\n\n` +
      `🆔 *LID:* ${lid}\n👤 *Nombre:* ${name}\n\n` +
      `👉 Si no fuiste tú, elimínalo desde el panel (Sedes → Admins) y cambia el PIN.`);
  }

  // ── Resumen diario ────────────────────────────────────
  _startOfTodayBogota() {
    const now = new Date();
    const bogota = new Date(now.getTime() - BOGOTA_OFFSET_HOURS * HOUR);
    return new Date(Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), BOGOTA_OFFSET_HOURS));
  }

  async sendDailySummaries() {
    if (!this._isEnabled('daily_summary')) return;
    const branches = await prisma.branch.findMany({
      where: { isAuthorized: true, isActive: true, notificationPhone: { not: null } },
      select: { id: true, name: true },
    });
    for (const branch of branches) {
      try {
        const text = await this.buildDailySummary(branch);
        if (text) await this.send(branch.id, 'daily_summary', text);
      } catch (error) {
        logger.error(`Error generando resumen diario de sede ${branch.id}:`, error.message);
      }
    }
  }

  async buildDailySummary(branch) {
    const since = this._startOfTodayBogota();

    const orders = await prisma.order.findMany({
      where: { branchId: branch.id, createdAt: { gte: since }, status: { not: 'CANCELLED' } },
      select: { amount: true, paymentMethod: true, status: true },
    });
    const attended = await prisma.conversation.count({
      where: { branchId: branch.id, messages: { some: { role: 'USER', createdAt: { gte: since } } } },
    });
    const newContacts = await prisma.contact.count({
      where: { branchId: branch.id, createdAt: { gte: since } },
    });
    const escalated = await prisma.conversation.count({
      where: { branchId: branch.id, status: 'ESCALATED' },
    });

    if (!orders.length && !attended) return null;

    const recent = await prisma.conversation.findMany({
      where: { branchId: branch.id, updatedAt: { gte: new Date(Date.now() - 3 * DAY) } },
      select: { context: true, updatedAt: true, contact: { select: { name: true, phone: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });

    const pendingLinks = [];
    const hotLeads = [];
    for (const conv of recent) {
      const sale = conv.context?.sale;
      if (!sale?.stage || sale.stage === 'comprado') continue;
      const who = conv.contact?.name && conv.contact.name !== 'Sin nombre'
        ? conv.contact.name : this._cleanPhone(conv.contact?.phone);
      if (sale.stage === 'link_enviado' && sale.pendingPayment) {
        pendingLinks.push(`• ${who} — ${formatCOP(sale.pendingPayment.amount || 0)}`);
      } else if (['decision', 'cierre', 'objecion'].includes(sale.stage) && new Date(conv.updatedAt) >= since) {
        const interest = (sale.interestProducts || []).slice(-2).join(', ') || 'sin producto definido';
        hotLeads.push(`• ${who} — ${interest}`);
      }
    }

    const total = orders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const cod = orders.filter(o => o.paymentMethod === 'CONTRAENTREGA').length;
    const wompi = orders.filter(o => o.paymentMethod === 'WOMPI').length;

    let text = `🏪 *Sede:* ${branch.name}\n\n` +
      `💰 *Ventas de hoy:* ${orders.length} (${formatCOP(total)})\n` +
      `   · Contraentrega: ${cod} · Wompi: ${wompi}\n` +
      `💬 *Chats atendidos:* ${attended}\n` +
      `🆕 *Clientes nuevos:* ${newContacts}\n`;
    if (escalated) text += `🙋 *Chats esperando atención humana:* ${escalated}\n`;
    if (pendingLinks.length) {
      text += `\n⏳ *Links de pago sin pagar (${pendingLinks.length}):*\n${pendingLinks.slice(0, 5).join('\n')}\n`;
    }
    if (hotLeads.length) {
      text += `\n🔥 *Clientes a punto de comprar (${hotLeads.length}):*\n${hotLeads.slice(0, 5).join('\n')}\n`;
      text += `\n👉 Sofía les hará seguimiento, pero un mensaje tuyo mañana puede cerrarlos.`;
    }
    return text.trim();
  }
}

module.exports = new OwnerAlertService();

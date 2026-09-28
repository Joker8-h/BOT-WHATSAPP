// ─────────────────────────────────────────────────────────
//  AI: Ficha de venta — memoria comercial de la conversación
//  Se guarda en conversation.context.sale y viaja entre conversaciones.
// ─────────────────────────────────────────────────────────
const { formatCOP } = require('../utils/helpers');

const FLOW_TO_STAGE = {
  WELCOME: 'conexion',
  DISCOVERY: 'descubrimiento',
  RECOMMEND: 'recomendacion',
  GUIDED_FANTASY: 'recomendacion',
  STRATEGIC_DIRECTION: 'decision',
  OBJECTION: 'objecion',
  SHIPPING_INFO: 'decision',
  CLOSING: 'cierre',
};

const STAGE_ORDER = ['conexion', 'descubrimiento', 'recomendacion', 'objecion', 'decision', 'cierre', 'link_enviado', 'comprado'];

const OBJECTION_LABELS = {
  precio: 'le pareció caro / busca algo más económico',
  pensarlo: 'dijo que lo va a pensar',
  duda_regalo: 'duda si a la otra persona le va a gustar',
  desconocimiento: 'no conoce del tema / siente vergüenza',
  discrecion: 'le preocupa la discreción',
  otra: 'tuvo otra duda',
};

function uniquePush(list = [], values = [], max = 6) {
  const out = [...list];
  for (const v of values) {
    const clean = String(v || '').trim();
    if (!clean) continue;
    const idx = out.findIndex(x => x.toLowerCase() === clean.toLowerCase());
    if (idx >= 0) out.splice(idx, 1);
    out.push(clean);
  }
  return out.slice(-max);
}

function normalizeIntent(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('regal')) return 'regalo';
  if (v.includes('pareja')) return 'pareja';
  if (v.includes('propio') || v.includes('mi') || v.includes('personal')) return 'propio';
  return v || null;
}

/**
 * Fusiona la ficha previa con lo que la IA capturó en este turno.
 * Devuelve null si no hay nada nuevo que guardar.
 */
function mergeSaleState(prev = {}, actions = {}, flow = null) {
  const sale = { ...(prev || {}) };
  let changed = false;

  if (actions.capturedIntent) { sale.intent = normalizeIntent(actions.capturedIntent); changed = true; }
  if (actions.capturedBudget) { sale.budget = actions.capturedBudget; changed = true; }
  if (actions.interestProducts?.length) {
    sale.interestProducts = uniquePush(sale.interestProducts, actions.interestProducts, 5);
    sale.lastInterestAt = new Date().toISOString();
    changed = true;
  }
  if (actions.objections?.length) {
    sale.objections = uniquePush(sale.objections, actions.objections.map(o => o.toLowerCase()), 6);
    changed = true;
  }
  if (actions.complementsOffered?.length) {
    sale.complementsOffered = uniquePush(sale.complementsOffered, actions.complementsOffered, 8);
    changed = true;
  }

  const flowStage = FLOW_TO_STAGE[flow];
  if (flowStage) {
    // La etapa no retrocede salvo que haya una objeción nueva o una venta ya cerrada
    const current = STAGE_ORDER.indexOf(sale.stage);
    const next = STAGE_ORDER.indexOf(flowStage);
    const restartAfterPurchase = sale.stage === 'comprado' && next < current;
    const leavingObjection = sale.stage === 'objecion' && flowStage !== 'conexion';
    if (current < 0 || next > current || flowStage === 'objecion' || leavingObjection || restartAfterPurchase) {
      if (sale.stage !== flowStage) { sale.stage = flowStage; changed = true; }
    }
  }

  if (!changed) return null;
  sale.updatedAt = new Date().toISOString();
  return sale;
}

function nextStepHint(sale) {
  if (!sale.interestProducts?.length) {
    return sale.intent
      ? 'Ya conoces la intención: haz como máximo UNA pregunta de descarte más y RECOMIENDA 1 o 2 productos.'
      : 'Descubre la intención (para sí, regalo o pareja) con una sola pregunta y avanza a recomendar.';
  }
  if (sale.stage === 'link_enviado') return 'Ya se envió link de pago: pregunta con amabilidad si pudo realizar el pago o si prefiere otra forma de pago.';
  if (sale.stage === 'comprado') return 'El cliente ya compró: atiéndelo como cliente VIP, ofrece complementos o recompra según lo que compró.';
  if (sale.stage === 'objecion') return 'Resuelve su objeción con el guion correspondiente (alternativa más económica, anclar la recomendación o tranquilizarlo) y termina con una pregunta fácil de responder.';
  if (!sale.complementsOffered?.length) return 'Ya tiene producto de interés: ofrece su complemento y pregunta "¿Lo llevas solo o con el complemento?".';
  return 'Lleva el cierre: pide forma de pago y datos de envío con preguntas alternativas.';
}

function formatSaleState(sale) {
  if (!sale || typeof sale !== 'object' || Object.keys(sale).length === 0) return '';
  const lines = ['## ESTADO DE LA VENTA (memoria del sistema — NO repitas preguntas ya resueltas)'];
  if (sale.intent) lines.push(`- Intención: ${sale.intent}`);
  if (sale.budget) lines.push(`- Presupuesto: ${sale.budget}`);
  if (sale.interestProducts?.length) lines.push(`- Productos que le interesaron: ${sale.interestProducts.join(', ')}`);
  if (sale.complementsOffered?.length) lines.push(`- Complementos ya ofrecidos: ${sale.complementsOffered.join(', ')} (no los repitas; si los rechazó, no insistas)`);
  if (sale.objections?.length) lines.push(`- Objeciones que ya planteó: ${sale.objections.map(o => OBJECTION_LABELS[o] || o).join('; ')}`);
  if (sale.stage) lines.push(`- Etapa actual: ${sale.stage}`);
  lines.push(`- Siguiente paso recomendado: ${nextStepHint(sale)}`);
  return lines.join('\n');
}

function formatOrderMemory(memory) {
  if (!memory) return '';
  const lines = [];
  if (memory.draft?.productos?.length) {
    lines.push(`- Pedido en curso (acordado, aún sin registrar): ${memory.draft.productos.join(', ')}${memory.draft.metodoPago ? ` — pago: ${memory.draft.metodoPago}` : ''}. Si el cliente vuelve, retoma este pedido sin preguntarle de nuevo qué quería.`);
  }
  for (const o of memory.pendingOrders || []) {
    lines.push(`- Pedido #${o.id} PENDIENTE (${o.status}): ${o.products.join(', ')} — ${formatCOP(o.amount)}. NO registres un pedido duplicado; si pregunta, confirma que está en proceso.`);
  }
  if (memory.lastPaidOrder) {
    const d = new Date(memory.lastPaidOrder.createdAt).toLocaleDateString('es-CO');
    lines.push(`- Última compra (${d}): ${memory.lastPaidOrder.products.join(', ')} — ${formatCOP(memory.lastPaidOrder.amount)}. Úsala para sugerir complementos o recompra.`);
  }
  if (!lines.length) return '';
  return `## PEDIDOS Y COMPRAS DEL CLIENTE\n${lines.join('\n')}`;
}

module.exports = { mergeSaleState, formatSaleState, formatOrderMemory, OBJECTION_LABELS };

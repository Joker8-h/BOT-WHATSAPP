// ══════════════════════════════════════════════════════
//  Costo de envío que se suma al valor de los productos.
//  Local (SHIPPING_LOCAL_CITIES, por defecto Popayán) o nacional.
// ══════════════════════════════════════════════════════

const toAmount = (value, fallback) => {
  const n = Number(String(value ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && String(value ?? '').trim() !== '' ? n : fallback;
};

const normalize = (text) => String(text || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const LOCAL_FEE = toAmount(process.env.SHIPPING_LOCAL_FEE, 6000);
const NATIONAL_FEE = toAmount(process.env.SHIPPING_NATIONAL_FEE, 15000);
const LOCAL_CITIES = (process.env.SHIPPING_LOCAL_CITIES || 'popayan')
  .split(',').map(normalize).filter(Boolean);

const money = (value) => `$${Number(value || 0).toLocaleString('es-CO')}`;

function isLocalCity(city) {
  const words = ` ${normalize(city)} `;
  return LOCAL_CITIES.some(local => words.includes(` ${local} `));
}

/**
 * @returns {{ fee: number, zone: 'local'|'nacional', label: string }}
 */
function getShipping(city) {
  const local = isLocalCity(city);
  return {
    fee: local ? LOCAL_FEE : NATIONAL_FEE,
    zone: local ? 'local' : 'nacional',
    label: local ? 'Envío local' : 'Envío nacional',
  };
}

/** Subtotal de productos + envío según la ciudad. */
function quote(productsTotal, city) {
  const subtotal = Number(productsTotal) || 0;
  const shipping = getShipping(city);
  return { subtotal, ...shipping, total: subtotal + shipping.fee };
}

/** Líneas "Productos / Envío / Total" para mensajes de WhatsApp. */
function breakdownLines({ subtotal, fee, label, total }) {
  return `🛍️ *Productos:* ${money(subtotal)}\n🚚 *${label}:* ${money(fee)}\n💰 *Total:* ${money(total)}`;
}

function promptSection(clientCity) {
  const localNames = (process.env.SHIPPING_LOCAL_CITIES || 'Popayán').split(',').map(s => s.trim()).filter(Boolean).join(', ');
  let text = `## COSTO DE ENVÍO (se suma al valor de los productos)
- Envío local (${localNames}): ${money(LOCAL_FEE)} COP.
- Envío nacional (cualquier otra ciudad o municipio): ${money(NATIONAL_FEE)} COP.
- El envío SIEMPRE se cobra junto con el pedido: en contraentrega se paga al recibir junto con los productos, y en el link de pago Wompi ya va incluido. El cliente NO le paga nada aparte a la transportadora.
- En el resumen de cierre muestra: productos + envío = total. Ej: "Vibrador $80.000 + envío ${money(LOCAL_FEE)} = *${money(80000 + LOCAL_FEE)}*".
- Si aún no sabes la ciudad, pregúntala antes de dar el total final.`;
  if (clientCity) {
    const s = getShipping(clientCity);
    text += `\n- La ciudad de este cliente es ${clientCity}: le corresponde ${s.label.toLowerCase()} de ${money(s.fee)} COP.`;
  }
  return text;
}

module.exports = { getShipping, quote, breakdownLines, promptSection, isLocalCity, LOCAL_FEE, NATIONAL_FEE };

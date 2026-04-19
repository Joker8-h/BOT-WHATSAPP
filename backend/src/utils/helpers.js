// ─────────────────────────────────────────────────────────
//  UTILS: Helpers
// ─────────────────────────────────────────────────────────

/**
 * Delay aleatorio para simular comportamiento humano (anti-ban)
 */
function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Delay de respuesta basado en config .env
 */
async function antiBanDelay() {
  const min = parseInt(process.env.MIN_RESPONSE_DELAY_MS) || 1500;
  const max = parseInt(process.env.MAX_RESPONSE_DELAY_MS) || 4500;
  await randomDelay(min, max);
}

/**
 * Formatear precio en pesos colombianos
 */
function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Limpiar número de teléfono
 */
function cleanPhone(phone) {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Obtener saludo según hora del día
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * Truncar texto a un máximo de caracteres
 */
function truncate(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Extraer solo los últimos N mensajes para contexto IA
 */
function getRecentMessages(messages, limit = 20) {
  return messages.slice(-limit);
}

module.exports = {
  randomDelay,
  antiBanDelay,
  formatCOP,
  cleanPhone,
  getGreeting,
  truncate,
  getRecentMessages,
};

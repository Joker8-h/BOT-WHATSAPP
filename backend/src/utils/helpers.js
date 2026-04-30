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
 * Verifica si estamos dentro del horario laboral (Colombia: UTC-5)
 * Lunes a Sábado, 9:00 AM - 6:00 PM
 */
function isWorkingHours() {
  const now = new Date();
  
  // Convertir a hora de Colombia (UTC-5)
  // Obtenemos el offset en minutos y lo ajustamos a -300 (UTC-5)
  const offset = now.getTimezoneOffset(); // en minutos
  const colombiaTime = new Date(now.getTime() + (offset - 300) * 60 * 1000);
  
  const day = colombiaTime.getDay(); // 0: Dom, 1: Lun, ..., 6: Sab
  const hour = colombiaTime.getHours();
  
  // Lunes (1) a Sábado (6)
  const isBusinessDay = day >= 1 && day <= 6;
  // 9:00 AM a 6:00 PM (18:00)
  const isBusinessHour = hour >= 9 && hour < 18;
  
  return isBusinessDay && isBusinessHour;
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
  isWorkingHours,
};

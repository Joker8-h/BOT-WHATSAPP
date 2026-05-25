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
 * Lista de festivos de Colombia 2026 (Formato MM-DD)
 */
const COLOMBIAN_HOLIDAYS_2026 = [
  '01-01', // Año Nuevo
  '01-06', // Reyes Magos
  '03-23', // San José
  '04-02', // Jueves Santo
  '04-03', // Viernes Santo
  '05-01', // Día del Trabajo
  '05-18', // Ascensión del Señor
  '06-08', // Corpus Christi
  '06-15', // Sagrado Corazón
  '06-29', // San Pedro y San Pablo
  '07-20', // Independencia de Colombia
  '08-07', // Batalla de Boyacá
  '08-17', // Asunción de la Virgen
  '10-12', // Día de la Raza
  '11-02', // Todos los Santos
  '11-16', // Independencia de Cartagena
  '12-08', // Inmaculada Concepción
  '12-25'  // Navidad
];

/**
 * Verifica si estamos dentro del horario laboral (Colombia: UTC-5)
 * Lunes a Sábado, 9:00 AM - 6:00 PM + Festivos
 */
function isWorkingHours() {
  const now = new Date();
  
  // Convertir a hora de Colombia (UTC-5)
  const offset = now.getTimezoneOffset(); // en minutos
  const colombiaTime = new Date(now.getTime() + (offset - 300) * 60 * 1000);
  
  const month = String(colombiaTime.getMonth() + 1).padStart(2, '0');
  const date = String(colombiaTime.getDate()).padStart(2, '0');
  const todayMMDD = `${month}-${date}`;

  // 1. Verificar si es festivo
  if (COLOMBIAN_HOLIDAYS_2026.includes(todayMMDD)) {
    return { isWorking: false, reason: 'holiday' };
  }

  const day = colombiaTime.getDay(); // 0: Dom, 1: Lun, ..., 6: Sab
  const hour = colombiaTime.getHours();
  
  // 2. Verificar si es Domingo (0)
  if (day === 0) {
    return { isWorking: false, reason: 'sunday' };
  }

  // 3. Verificar Horario (9:00 AM a 6:00 PM)
  const isBusinessHour = hour >= 9 && hour < 18;
  if (!isBusinessHour) {
    return { isWorking: false, reason: 'off-hours' };
  }
  
  return { isWorking: true, reason: null };
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

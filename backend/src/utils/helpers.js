// ─────────────────────────────────────────────────────────
//  UTILS: Helpers
// ─────────────────────────────────────────────────────────

const logger = require('./logger');

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
 * Obtener componentes de fecha y hora exactos para Colombia (America/Bogota, UTC-5)
 */
function getColombiaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(map.year, 10),
    month: map.month,
    date: map.day,
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    day: weekdayMap[map.weekday] ?? 0,
    todayMMDD: `${map.month}-${map.day}`,
  };
}

/**
 * Obtener saludo según hora del día en Colombia
 */
function getGreeting() {
  const { hour } = getColombiaParts();
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
 * Verifica si estamos dentro del horario laboral
 * @param {number|null} branchId - Si se provee, verifica horario de esa sede
 */
async function isWorkingHours(branchId = null) {
  const settingsService = require('../services/settingsService');
  let settings = settingsService.get();

  // Si hay branchId, verificar si tiene horario propio
  if (branchId) {
    try {
      const branchSchedule = await settingsService.getBranchSchedule(branchId);
      if (branchSchedule && !branchSchedule.useGlobalSchedule) {
        settings = {
          workingHoursStart: branchSchedule.workingHoursStart ?? 9,
          workingHoursEnd: branchSchedule.workingHoursEnd ?? 18,
          workingDays: branchSchedule.workingDays || '1,2,3,4,5,6',
          holidays: settings.holidays, // festivos siempre globales
          closedForLunch: branchSchedule.closedForLunch ?? false,
          lunchStart: branchSchedule.lunchStart,
          lunchEnd: branchSchedule.lunchEnd,
        };
      }
    } catch (e) {
      logger.warn(`⚠️ Error obteniendo horario de sede ${branchId}: ${e.message}`);
    }
  }

  const { todayMMDD, day, hour } = getColombiaParts();

  // 2. Verificar días de trabajo
  const workingDays = (settings.workingDays || '1,2,3,4,5,6').split(',').map(Number);
  if (!workingDays.includes(day)) {
    return { isWorking: false, reason: 'non-working-day' };
  }

  // 3. Verificar horario
  const start = settings.workingHoursStart ?? 9;
  const end = settings.workingHoursEnd ?? 18;
  if (hour < start || hour >= end) {
    return { isWorking: false, reason: 'off-hours' };
  }

  // 4. Verificar almuerzo
  if (settings.closedForLunch && settings.lunchStart != null && settings.lunchEnd != null) {
    if (hour >= settings.lunchStart && hour < settings.lunchEnd) {
      return { isWorking: false, reason: 'lunch-break' };
    }
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
  getColombiaParts,
};

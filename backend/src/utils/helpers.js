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

/**
 * Verifica si un número, JID o string pertenece a un número bloqueado.
 * Maneja sufijos de dispositivo (:45), dominios (@c.us, @s.whatsapp.net), y prefijo de país (57).
 */
function isPhoneBlocked(rawPhoneOrJid) {
  if (!rawPhoneOrJid) return false;
  const defaultBlocked = ['3106124802', '3153993910'];
  const envBlocked = (process.env.BLOCKED_NUMBERS || '').split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
  const BLOCKED_NUMBERS = Array.from(new Set([...defaultBlocked, ...envBlocked]));

  const rawStr = String(rawPhoneOrJid);
  const beforeDomain = rawStr.split('@')[0];
  const beforeDevice = beforeDomain.split(':')[0];
  const digitsOnly = beforeDevice.replace(/\D/g, '');

  return BLOCKED_NUMBERS.some(blocked => {
    const bDigits = String(blocked).replace(/\D/g, '');
    if (!bDigits) return false;
    return (
      digitsOnly === bDigits ||
      digitsOnly === '57' + bDigits ||
      (bDigits.length >= 10 && digitsOnly.endsWith(bDigits)) ||
      rawStr.includes(bDigits)
    );
  });
}

/**
 * Limpia un identificador de WhatsApp (JID, LID, o teléfono) extrayendo solo dígitos limpios
 */
function cleanPhoneDigits(raw) {
  if (!raw) return '';
  const str = String(raw).split('@')[0].split(':')[0];
  return str.replace(/\D/g, '');
}

/**
 * Formatea un número de teléfono en formato normal colombiano (ej: "316 657 5904").
 * Elimina completamente cualquier ID técnico (@c.us, @lid, etc.).
 */
function formatDisplayPhone(raw, options = { withCountryCode: false }) {
  if (!raw) return 'No registrado';
  const rawStr = String(raw);
  const digits = cleanPhoneDigits(rawStr);

  // Si tiene 12 dígitos y empieza por 573 (móvil colombiano con código de país 57)
  if (digits.length === 12 && digits.startsWith('573')) {
    const colNumber = digits.slice(2);
    const formatted = `${colNumber.slice(0, 3)} ${colNumber.slice(3, 6)} ${colNumber.slice(6)}`;
    return options.withCountryCode ? `+57 ${formatted}` : formatted;
  }

  // Si tiene 10 dígitos y empieza por 3 (móvil colombiano estándar)
  if (digits.length === 10 && digits.startsWith('3')) {
    const formatted = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    return options.withCountryCode ? `+57 ${formatted}` : formatted;
  }

  // Si parece ser un ID técnico / LID de WhatsApp Web o no es un número celular real
  if (rawStr.includes('@lid') || digits.length > 13) {
    return 'Chat WhatsApp';
  }

  // Cualquier otro número numérico válido (7 a 11 dígitos)
  if (digits.length >= 7) {
    return digits;
  }

  return 'No registrado';
}

/**
 * Genera el enlace directo a WhatsApp (https://wa.me/57...) únicamente si es un número válido.
 */
function formatWaLink(raw) {
  if (!raw) return null;
  const rawStr = String(raw);
  if (rawStr.includes('@lid')) return null;

  const digits = cleanPhoneDigits(rawStr);
  if (digits.length < 10 || digits.length > 13) return null;

  const canonical = digits.startsWith('57') ? digits : `57${digits}`;
  return `https://wa.me/${canonical}`;
}

/**
 * Retorna un nombre legible para el cliente, evitando cadenas técnicas como "Cliente 573166575904@c.us"
 */
function formatClientDisplayName(name, rawPhone) {
  if (name && name !== 'Sin nombre' && !name.startsWith('Cliente 57') && !name.includes('@')) {
    return name;
  }
  const displayPhone = formatDisplayPhone(rawPhone);
  if (displayPhone && displayPhone !== 'No registrado' && displayPhone !== 'Chat WhatsApp') {
    return `Cliente (${displayPhone})`;
  }
  return 'Cliente';
}

module.exports = {
  randomDelay,
  antiBanDelay,
  formatCOP,
  cleanPhone,
  cleanPhoneDigits,
  formatDisplayPhone,
  formatWaLink,
  formatClientDisplayName,
  getGreeting,
  truncate,
  getRecentMessages,
  isWorkingHours,
  getColombiaParts,
  isPhoneBlocked,
};

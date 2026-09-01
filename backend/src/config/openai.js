// ─────────────────────────────────────────────────────────
//  CONFIG: OpenAI / OpenRouter Client — con fallback y retry
// ─────────────────────────────────────────────────────────
const OpenAI = require('openai');

// Soporta tanto OpenAI directo como OpenRouter (si se define baseURL)
const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL || undefined;

if (!apiKey) {
  console.warn('⚠️ OPENAI_API_KEY no definido — las llamadas IA fallarán hasta configurarlo');
}

const openai = new OpenAI({
  apiKey: apiKey || 'missing-key',
  baseURL,
  // Timeout más corto para detectar rápido y reintentar con fallback
  timeout: 30000,
  maxRetries: 0, // manejamos reintentos manualmente con fallback de modelo
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Cadena de fallbacks cuando gpt-4o está rate-limited / agotado
const FALLBACK_MODELS = (process.env.FALLBACK_MODELS || 'gpt-4o-mini,gpt-4o-mini-2024-07-18,gpt-4-turbo,gpt-3.5-turbo')
  .split(',')
  .map(m => m.trim())
  .filter(Boolean);

// Todos los modelos a probar en orden (primario + fallbacks sin duplicar)
const MODEL_CHAIN = [MODEL, ...FALLBACK_MODELS.filter(m => m !== MODEL)];

module.exports = { openai, MODEL, MODEL_CHAIN, FALLBACK_MODELS };

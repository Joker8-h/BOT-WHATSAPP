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

// ─── Groq (proveedor secundario OpenAI-compatible, solo chat de texto) ───
// Whisper/TTS/visión siempre quedan en OpenAI. Groq entra solo si OpenAI se agota.
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: GROQ_BASE_URL,
    timeout: 30000,
    maxRetries: 0,
  });
} else {
  console.warn('⚠️ GROQ_API_KEY no definido — fallback Groq deshabilitado (solo OpenAI)');
}

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODELS = (process.env.GROQ_FALLBACK_MODELS || 'llama-3.1-8b-instant,mixtral-8x7b-32768')
  .split(',')
  .map(m => m.trim())
  .filter(Boolean);
const GROQ_CHAIN = [GROQ_MODEL, ...GROQ_FALLBACK_MODELS.filter(m => m !== GROQ_MODEL)];

// Orden de proveedores: openai,groq (permite invertir en pruebas con AI_PROVIDER_ORDER=groq,openai)
const PROVIDER_ORDER = (process.env.AI_PROVIDER_ORDER || 'openai,groq')
  .split(/[,\s]+/)
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

module.exports = { openai, MODEL, MODEL_CHAIN, FALLBACK_MODELS, groq, GROQ_MODEL, GROQ_CHAIN, GROQ_FALLBACK_MODELS, PROVIDER_ORDER, GROQ_BASE_URL };

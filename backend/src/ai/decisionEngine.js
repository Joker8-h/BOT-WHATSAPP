// ─────────────────────────────────────────────────────────
//  AI: Sistema de Decisión — Clasificación de Clientes
// ─────────────────────────────────────────────────────────
const { openai, MODEL, MODEL_CHAIN } = require('../config/openai');
const logger = require('../utils/logger');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isRateLimitError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err?.error?.status || err?.response?.status;
  if (status === 429) return true;
  const msg = (err.message || err.error?.message || '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('quota exceeded');
}

/**
 * Analiza la conversación y clasifica al cliente
 * Retorna: { clientType, confidenceLevel, purchaseStage, shouldEscalate }
 */
async function classifyClient(conversationHistory) {
  try {
    const analysisPrompt = `Analiza esta conversación de WhatsApp y clasifica al cliente.

CONVERSACIÓN:
${conversationHistory.map(m => `${m.role === 'USER' ? 'Cliente' : 'Asistente'}: ${m.content}`).join('\n')}

Responde SOLO en este formato JSON exacto, sin texto adicional:
{
  "clientType": "TIMIDO|EXPLORADOR|DECIDIDO",
  "confidenceLevel": "BAJO|MEDIO|ALTO",
  "purchaseStage": "CURIOSO|INTERESADO|DECIDIDO",
  "shouldEscalate": false,
  "reasoning": "explicación breve"
}

CRITERIOS:
- TÍMIDO: respuestas cortas, risas nerviosas, evasivo, pide disculpas
- EXPLORADOR: pregunta opciones, quiere ver variedad, curioso
- DECIDIDO: pregunta precios directamente, sabe lo que quiere

- Confianza BAJA: <3 mensajes o muy tímido
- Confianza MEDIA: 3-8 mensajes, se va soltando
- Confianza ALTA: >8 mensajes, conversa fluido

- CURIOSO: acaba de llegar, no sabe qué busca
- INTERESADO: pregunta sobre productos específicos
- DECIDIDO: pregunta precio, envío, cómo pagar

- shouldEscalate: true solo si el cliente está molesto, confuso, o pide hablar con alguien`;

    // Retry con fallback de modelos en caso de RATE_LIMIT (evita bloquear el flujo principal)
    let lastErr = null;
    for (const model of MODEL_CHAIN.slice(0, 3)) { // solo 3 primeros para clasificación (rápido)
      try {
        const response = await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: analysisPrompt }],
          temperature: 0.3,
          max_tokens: 300,
          response_format: { type: 'json_object' },
        });
        const result = JSON.parse(response.choices[0].message.content);
        logger.debug('Clasificación de cliente:', result);
        return result;
      } catch (err) {
        lastErr = err;
        if (isRateLimitError(err)) {
          logger.warn(`⚠️ [RATE_LIMIT] classifyClient ${model} agotado, probando siguiente`);
          await sleep(400 + Math.random() * 400);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  } catch (error) {
    if (isRateLimitError(error)) {
      logger.warn('⚠️ RATE_LIMIT en classifyClient — usando fallback NUEVO/BAJO');
    } else {
      logger.error('Error clasificando cliente:', error);
    }
    return {
      clientType: 'NUEVO',
      confidenceLevel: 'BAJO',
      purchaseStage: 'CURIOSO',
      shouldEscalate: false,
    };
  }
}

/**
 * Decide qué categorías de productos recomendar según el tipo de cliente
 */
function getRecommendedCategories(clientType) {
  const map = {
    TIMIDO: ['CONEXION_PAREJA'],
    EXPLORADOR: ['EXPLORACION_SUAVE', 'SORPRESAS_DISCRETAS'],
    DECIDIDO: ['EXPERIENCIAS_INTENSAS', 'EXPLORACION_SUAVE'],
    NUEVO: ['CONEXION_PAREJA'],
    RECURRENTE: ['SORPRESAS_DISCRETAS', 'EXPERIENCIAS_INTENSAS'],
  };
  return map[clientType] || ['CONEXION_PAREJA'];
}

/**
 * Determina cuántos productos mostrar según confianza
 */
function getProductLimit(confidenceLevel) {
  const map = { BAJO: 4, MEDIO: 8, ALTO: 12 };
  return map[confidenceLevel] || 4;
}

module.exports = { classifyClient, getRecommendedCategories, getProductLimit };

// ─────────────────────────────────────────────────────────
//  AI: Sistema de Decisión — Clasificación de Clientes
// ─────────────────────────────────────────────────────────
const { openai, MODEL } = require('../config/openai');
const logger = require('../utils/logger');

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

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content);
    logger.debug('Clasificación de cliente:', result);
    return result;
  } catch (error) {
    logger.error('Error clasificando cliente:', error);
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
  const map = { BAJO: 1, MEDIO: 2, ALTO: 3 };
  return map[confidenceLevel] || 1;
}

module.exports = { classifyClient, getRecommendedCategories, getProductLimit };

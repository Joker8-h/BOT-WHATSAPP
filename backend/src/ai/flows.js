// ─────────────────────────────────────────────────────────
//  AI: Flujos Conversacionales
// ─────────────────────────────────────────────────────────

/**
 * Detecta el flujo actual basado en el contenido del mensaje y el contexto
 */
function detectFlow(message, context) {
  const msg = message.toLowerCase().trim();
  const messageCount = context?.messageCount || 0;

  // Palabras clave de activación
  const keywords = {
    greeting: ['hola', 'buenas', 'hi', 'hey', 'ola', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal'],
    price: ['precio', 'cuanto', 'cuánto', 'vale', 'cuesta', 'valor', 'costos', 'costo'],
    shipping: ['envio', 'envío', 'llega', 'domicilio', 'despacho', 'entregan'],
    payment: ['pago', 'pagar', 'tarjeta', 'transferencia', 'nequi', 'daviplata'],
    catalog: ['catalogo', 'catálogo', 'productos', 'que tienen', 'qué tienen', 'que venden'],
    help: ['ayuda', 'asesor', 'asesora', 'humano', 'persona', 'hablar con alguien'],
    thanks: ['gracias', 'gracia', 'thank', 'perfecto', 'listo', 'vale gracias'],
    gift: ['regalo', 'sorpresa', 'aniversario', 'cumpleaños', 'especial'],
    couple: ['pareja', 'novio', 'novia', 'esposo', 'esposa', 'relación'],
  };

  // Detectar escalamiento
  if (keywords.help.some(k => msg.includes(k))) {
    return 'ESCALATION';
  }

  // Detectar cierre
  if (keywords.payment.some(k => msg.includes(k))) {
    return 'CLOSING';
  }

  // Detectar interés en precios (dirección al cierre)
  if (keywords.price.some(k => msg.includes(k))) {
    return 'STRATEGIC_DIRECTION';
  }

  // Detectar preguntas de envío
  if (keywords.shipping.some(k => msg.includes(k))) {
    return 'CLOSING';
  }

  // Primera interacción
  if (messageCount === 0 || keywords.greeting.some(k => msg.includes(k))) {
    return 'WELCOME';
  }

  // Busca catálogo completo
  if (keywords.catalog.some(k => msg.includes(k))) {
    return 'DISCOVERY';
  }

  // Menciona regalo o sorpresa
  if (keywords.gift.some(k => msg.includes(k))) {
    return 'GUIDED_FANTASY';
  }

  // Menciona pareja
  if (keywords.couple.some(k => msg.includes(k))) {
    return 'GUIDED_FANTASY';
  }

  // Agradecimiento / despedida
  if (keywords.thanks.some(k => msg.includes(k))) {
    return 'FAREWELL';
  }

  // Por defecto según la etapa de la conversación
  if (messageCount < 3) return 'DISCOVERY';
  if (messageCount < 8) return 'GUIDED_FANTASY';
  return 'STRATEGIC_DIRECTION';
}

/**
 * Genera instrucciones adicionales según el flujo activo
 */
function getFlowInstructions(flow) {
  const instructions = {
    WELCOME: `FLUJO ACTUAL: BIENVENIDA
- Saluda de forma cálida y personalizada
- Si es cliente nuevo: preséntate brevemente como asesor de Fantasías  
- Rompe el hielo con algo como "¿buscas algo especial para ti o para sorprender a alguien?"
- NO ofrezcas productos aún, primero conecta`,

    DISCOVERY: `FLUJO ACTUAL: DESCUBRIMIENTO
- Haz 1-2 preguntas suaves para entender qué busca
- Ejemplos: "¿Es para ti o para regalar?", "¿Buscas algo para una ocasión especial?"
- NO muestres catálogo, identifica la necesidad primero
- Sé empático si notas timidez`,

    GUIDED_FANTASY: `FLUJO ACTUAL: FANTASÍA GUIADA
- Presenta los productos como EXPERIENCIAS, no como objetos
- Crea un escenario emocional: "Imagina una noche donde..."
- Recomienda 1-2 productos máximo basándote en lo que ha dicho
- Usa la descripción emocional del producto, no la técnica`,

    STRATEGIC_DIRECTION: `FLUJO ACTUAL: DIRECCIÓN ESTRATÉGICA
- El cliente muestra interés real
- Empuja el producto estrella de la categoría relevante
- Menciona beneficios emocionales
- Si pregunta precio, dilo con confianza y agrega el valor de la experiencia
- Prepárate para el cierre`,

    CLOSING: `FLUJO ACTUAL: CIERRE DE VENTA
- Confirma el producto que quiere
- Da el precio claro en COP
- Explica: envío discreto a toda Colombia
- Indica que le enviarás un link de pago seguro
- Usa [CERRAR_VENTA:nombre_del_producto] para activar el link de pago
- NO presiones, pero facilita el camino`,

    ESCALATION: `FLUJO ACTUAL: ESCALAMIENTO A HUMANO
- El cliente quiere hablar con una persona
- Confirma amablemente: "Claro, con mucho gusto te comunico con uno de nuestros asesores"
- Indica que alguien se comunicará pronto
- Responde con [ESCALAR] al final de tu mensaje`,

    FAREWELL: `FLUJO ACTUAL: DESPEDIDA
- Agradece amablemente
- Recuerda que estás disponible cuando quiera
- Si compró: confirma que su pedido está en proceso
- Cierra con calidez`,
  };

  return instructions[flow] || instructions.DISCOVERY;
}

module.exports = { detectFlow, getFlowInstructions };

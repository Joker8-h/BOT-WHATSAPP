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
    help: ['ayuda', 'asesor', 'asesora', 'humano', 'persona', 'hablar con alguien', 'administrador', 'reclamo', 'queja', 'jefe', 'gerente', 'quejarme'],
    thanks: ['gracias', 'gracia', 'thank', 'perfecto', 'listo', 'vale gracias'],
    gift: ['regalo', 'sorpresa', 'aniversario', 'cumpleaños', 'especial'],
    couple: ['pareja', 'novio', 'novia', 'esposo', 'esposa', 'relación'],
    replyToContact: ['escribiste', 'atendiendo', 'vi tu mensaje', 'vi el mensaje', 'veo tu mensaje', 'hace rato', 'recién veo', 'no te había visto', 'me mandaste', 'me enviaste', 'te respondo'],
    store: ['tienda física', 'donde quedan', 'ubicación', 'sucursal', 'donde están', 'popayán', 'florencia', 'yopal', 'local fisico'],
  };

  // Detectar escalamiento
  if (keywords.help.some(k => msg.includes(k))) {
    return 'ESCALATION';
  }

  // Respondiendo a un mensaje previo (follow-up)
  if (keywords.replyToContact.some(k => msg.includes(k))) {
    return 'CONTACT_REPLY';
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

  // Pregunta por locales físicos
  if (keywords.store.some(k => msg.includes(k))) {
    return 'PHYSICAL_STORE';
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
- Recomienda hasta 5 productos (o más si el cliente los pide) basándote en lo que ha dicho
- Usa la descripción emocional del producto, no la técnica`,

    STRATEGIC_DIRECTION: `FLUJO ACTUAL: DIRECCIÓN ESTRATÉGICA
- El cliente muestra interés real
- Empuja el producto estrella de la categoría relevante
- Menciona beneficios emocionales
- Si pregunta precio, dilo con confianza y agrega el valor de la experiencia
- Prepárate para el cierre`,

    CLOSING: `FLUJO ACTUAL: CIERRE DE VENTA
- **PRIMERO VERIFICA**: ¿Tienes la DIRECCIÓN del cliente capturada con [CAPTURAR_DIRECCION] y la CIUDAD con [CAPTURAR_CIUDAD]? Si falta alguno, PÍDELO ANTES de continuar. NO cierres la venta sin dirección.
- Confirma el producto que quiere
- Da el precio claro en COP
- Si el cliente pregunta por CONTRAENTREGA:
  * Revisa la CIUDAD del cliente en el perfil
  * Si está en Pitalito, Florencia, Popayán o Yopal: confirma que sí hay contraentrega solo dentro de la ciudad, y espera a que el cliente CONFIRME que lo quiere
  * Si el cliente dice que SÍ lo quiere por contraentrega, verifica que tengas dirección y usa [PEDIDO_CONTRAENTREGA:nombre_del_producto]
  * Si NO está en esas ciudades: explícale que contraentrega solo está disponible en esas 4 ciudades, y ofrécele pago por link seguro Wompi
- Si el cliente acepta pagar por Wompi, verifica que tengas dirección y usa [CERRAR_VENTA:nombre_del_producto] para activar el link de pago
- NO presiones, pero facilita el camino
- **REGLA CRÍTICA**: Sin dirección capturada con [CAPTURAR_DIRECCION], NO uses [CERRAR_VENTA] ni [PEDIDO_CONTRAENTREGA]. Pide la dirección primero.`,

    CONTACT_REPLY: `FLUJO ACTUAL: RESPUESTA A CONTACTO
- El cliente está respondiendo a un mensaje previo que le enviaste
- Recíbelo natural: "Holaa, claro, por cierto agrégame a tus contactos como Sofía y así tenemos el contacto directo"
- Hazlo sonar como un comentario casual, no como pregunta
- Luego transiciona suavemente al flujo de venta: pregúntale qué necesita o si quiere que le muestres productos`,

    PHYSICAL_STORE: `FLUJO ACTUAL: INFORMACIÓN DE LOCALES
- El cliente pregunta por tiendas físicas
- Usa la información de los locales disponible en el sistema (## LOCALES FÍSICOS)
- Proporciona los datos con amabilidad: dirección, puntos de referencia, fachada si aplica
- IMPORTANTE: Si está Yopal en los locales, menciona que está disponible solo por ahora esta semana y que avisamos si hay cambios
- Luego de informar, pregúntale si necesita algo más o si quiere ver productos`,

    ESCALATION: `FLUJO ACTUAL: ESCALAMIENTO A HUMANO
- El cliente quiere hablar con una persona o administrador, o está molesto.
- Confirma cortamente: "Entiendo perfectamente. Ya mismo te comunico con uno de nuestros asesores para ayudarte."
- NO des correos ni números. Solo di que ya los pasas.
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

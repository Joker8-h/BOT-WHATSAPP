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
    confirmSale: ['enviamelo', 'enviamelos', 'envíamelo', 'envíamelos', 'sí quiero', 'si quiero', 'dale', 'ok compra', 'lo quiero', 'sí lo llevo', 'si lo llevo', 'confirmo', 'correcto', 'afirmativo', 'eso', 'sale', 'deacuerdo', 'de acuerdo', 'ok mande', 'ok envíe', 'ok enviame'],
    catalog: ['catalogo', 'catálogo', 'productos', 'que tienen', 'qué tienen', 'que venden'],
    help: ['ayuda', 'asesor', 'asesora', 'humano', 'persona', 'hablar con alguien', 'administrador', 'reclamo', 'queja', 'jefe', 'gerente', 'quejarme'],
    thanks: ['gracias', 'gracia', 'thank', 'perfecto', 'listo', 'vale gracias'],
    gift: ['regalo', 'sorpresa', 'aniversario', 'cumpleaños', 'especial'],
    couple: ['pareja', 'novio', 'novia', 'esposo', 'esposa', 'relación'],
    replyToContact: ['escribiste', 'atendiendo', 'vi tu mensaje', 'vi el mensaje', 'veo tu mensaje', 'hace rato', 'recién veo', 'no te había visto', 'me mandaste', 'me enviaste', 'te respondo'],
    store: ['tienda física', 'donde quedan', 'ubicación', 'sucursal', 'donde están', 'popayán', 'florencia', 'yopal', 'local fisico'],
    address: ['calle', 'carrera', 'cra', 'avenida', 'av', 'diagonal', 'transversal', 'barrio', 'torre', 'apto', 'apartamento', 'manzana', 'lote'],
    polla: ['polla', 'mundial', 'futbol', 'fútbol', 'copa', 'mundialista', 'champions', 'liga', 'partido', 'apostar', 'apuesta'],
  };

  // Detectar polla mundialista (PRIORIDAD MÁXIMA — antes de cualquier otro flujo)
  if (keywords.polla.some(k => msg.includes(k))) {
    return 'POLL';
  }

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

  // Detectar confirmación de compra (el cliente dice que sí, que lo envíen, etc.)
  if (keywords.confirmSale.some(k => msg.includes(k))) {
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

  // Detectar dirección del cliente (cuando responde con su dirección después de que se la pedimos)
  const hasAddressKeyword = keywords.address.some(k => msg.includes(k));
  const hasNumberAndHash = /\d+\s*[-#]\s*\d+/.test(msg);
  if (hasAddressKeyword && (hasNumberAndHash || msg.length > 10)) {
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
- **PRIORIDAD DEL MÉTODO DE PAGO**: Si el cliente menciona explícitamente 'nequi', 'daviplata', 'transferencia', 'tarjeta' o cualquier pago electrónico: USA [CERRAR_VENTA] para generar link Wompi. IGNORA la regla de ciudad. El método de pago elegido por el cliente tiene prioridad.
- **CIERRE AUTOMÁTICO**: Cuando el cliente confirme que quiere comprar (ej: "sí", "de acuerdo", "dale", "lo llevo", "añádelo", "en efectivo", "confirmo"):
  * Si el cliente NO mencionó un método de pago específico Y la CIUDAD es Pitalito, Florencia, Popayán o Yopal: usa INMEDIATAMENTE [PEDIDO_CONTRAENTREGA:nombre_exacto_del_producto]. NO esperes que el cliente diga la palabra "contraentrega".
  * Si el cliente mencionó nequi/daviplata/transferencia/tarjeta O la ciudad NO está en la lista: usa [CERRAR_VENTA:nombre_del_producto] para generar el link de pago Wompi.
- **CUANDO EL CLIENTE DIGA QUE SÍ QUIERE COMPRAR** (ej: "sí quiero", "envíamelo", "dale", "lo llevo", "confirmo", "quiero pagar en efectivo"), DEBES usar [CERRAR_VENTA] o [PEDIDO_CONTRAENTREGA] INMEDIATAMENTE. NO preguntes más, NO des más información, CIERRA la venta.
- NO presiones, pero facilita el camino
- **REGLA CRÍTICA**: Sin dirección capturada con [CAPTURAR_DIRECCION], NO uses [CERRAR_VENTA] ni [PEDIDO_CONTRAENTREGA]. Pide la dirección primero.
- **RECUERDA**: Después de usar la etiqueta, NO digas "Pedido registrado" ni confirmes como exitoso. Solo di "Perfecto, procederé a registrar tu pedido..." y el sistema se encarga del resto.`,

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

    POLL: `FLUJO ACTUAL: POLLA MUNDIALISTA
- El cliente pregunta por la polla mundialista, fútbol, copa, mundial, o cualquier tema relacionado
- Responde con entusiasmo y calidez
- SIEMPRE incluye el link: https://polla.fantasias.com.co
- Sé breve y directo: NO vendas productos en este momento
- Ejemplo de respuesta: "¡Claro que sí! 🏆 Participa en nuestra polla mundialista y compite con otros fans. Entra aquí 👉 https://polla.fantasias.com.co ¿En qué más te puedo ayudar?"
- Si el cliente quiere volver a productos, transiciona suavemente al flujo de ventas`,

    FAREWELL: `FLUJO ACTUAL: DESPEDIDA
- Agradece amablemente
- Recuerda que estás disponible cuando quiera
- Si compró: confirma que su pedido está en proceso
- Cierra con calidez`,
  };

  return instructions[flow] || instructions.DISCOVERY;
}

module.exports = { detectFlow, getFlowInstructions };

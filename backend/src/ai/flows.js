// ─────────────────────────────────────────────────────────
//  AI: Flujos Conversacionales
// ─────────────────────────────────────────────────────────
const { normalizeText, containsPhrase, detectProductTypes } = require('./salesKnowledge');

// Todas las palabras se comparan normalizadas (sin tildes, minúsculas) y como
// palabras/frases completas: "eso" ya no coincide con "beso", ni "av" con "nuevo".
const KEYWORDS = {
  polla: ['polla mundialista', 'polla futbolera', 'mundial de futbol', 'quiniela', 'apuesta mundial', 'copa mundial', 'champions league'],
  help: ['humano', 'hablar con alguien', 'hablar con una persona', 'persona real', 'administrador', 'reclamo', 'queja', 'jefe', 'gerente', 'quejarme', 'supervisor'],
  replyToContact: ['escribiste', 'vi tu mensaje', 'vi el mensaje', 'veo tu mensaje', 'recien veo', 'no te habia visto', 'me mandaste', 'me enviaste', 'te respondo'],
  objection: [
    'caro', 'cara', 'costoso', 'costosa', 'muy caro', 'no tengo plata', 'no me alcanza', 'mas barato', 'mas barata', 'mas economico', 'mas economica', 'algo barato', 'barato', 'barata',
    'lo pienso', 'lo voy a pensar', 'voy a pensar', 'dejame pensarlo', 'dejeme pensarlo', 'despues te escribo', 'despues te aviso', 'luego te escribo', 'luego te aviso', 'otro dia', 'mas adelante',
    'no se si le guste', 'no se si le va a gustar', 'no estoy seguro', 'no estoy segura', 'no conozco', 'me da pena', 'me da verguenza', 'es discreto', 'discreto', 'discreta', 'discrecion',
    'si funciona', 'funciona de verdad', 'si sirve', 'es bueno',
  ],
  payment: ['pago', 'pagar', 'tarjeta', 'transferencia', 'nequi', 'daviplata', 'contraentrega', 'contra entrega', 'efectivo', 'link de pago'],
  confirmSale: [
    'si quiero', 'lo quiero', 'los quiero', 'la quiero', 'lo llevo', 'si lo llevo', 'me lo llevo', 'los llevo', 'enviamelo', 'enviamelos', 'mandamelo', 'mandamelos',
    'dale', 'confirmo', 'de acuerdo', 'deacuerdo', 'ok compra', 'hagamos el pedido', 'quiero pedir', 'quiero comprar', 'lo compro', 'los compro', 'con el complemento', 'con los dos',
  ],
  orderTracking: ['mi pedido', 'mi paquete', 'mi compra', 'numero de guia', 'la guia', 'tienen guia', 'tienen numero de guia', 'donde va mi pedido', 'estado de mi pedido', 'ya lo enviaron', 'cuando llega mi pedido', 'guia de envio', 'mi envio', 'rastreo'],
  price: ['precio', 'precios', 'cuanto', 'cuesta', 'valor', 'costo', 'costos'],
  shipping: ['envio', 'envios', 'domicilio', 'despacho', 'entregan', 'hacen envios', 'cuanto tarda', 'cuanto se demora', 'llega'],
  catalog: ['catalogo', 'productos', 'que tienen', 'que venden', 'que manejan'],
  store: ['tienda fisica', 'donde quedan', 'ubicacion', 'sucursal', 'donde estan', 'local fisico', 'tienen tienda', 'tienen local', 'direccion de la tienda'],
  gift: ['regalo', 'regalar', 'sorpresa', 'sorprender', 'aniversario', 'cumpleanos', 'san valentin', 'amor y amistad'],
  couple: ['pareja', 'novio', 'novia', 'esposo', 'esposa', 'mi relacion'],
  thanks: ['gracias', 'muchas gracias', 'thank you', 'bendiciones', 'chao', 'hasta luego'],
  greeting: ['hola', 'holi', 'holaa', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'hey'],
  addressWords: ['calle', 'carrera', 'cra', 'cl', 'kr', 'avenida', 'diagonal', 'transversal', 'barrio', 'torre', 'apto', 'apartamento', 'manzana', 'mz', 'casa', 'conjunto'],
};

function hasAny(msg, list) {
  return list.some(k => containsPhrase(msg, k));
}

/**
 * Detecta el flujo actual basado en el contenido del mensaje y el contexto
 */
function detectFlow(message, context = {}) {
  const msg = normalizeText(message);
  const messageCount = context.messageCount || 0;
  const sale = context.sale || {};

  if (hasAny(msg, KEYWORDS.polla)) return 'POLL';
  if (hasAny(msg, KEYWORDS.help)) return 'ESCALATION';
  if (hasAny(msg, KEYWORDS.replyToContact)) return 'CONTACT_REPLY';

  const looksLikeAddress = hasAny(msg, KEYWORDS.addressWords) && /\d/.test(msg);
  if (looksLikeAddress) return 'CLOSING';

  if (hasAny(msg, KEYWORDS.confirmSale)) return 'CLOSING';
  if (hasAny(msg, KEYWORDS.payment)) return 'CLOSING';

  if (hasAny(msg, KEYWORDS.objection)) return 'OBJECTION';

  if (hasAny(msg, KEYWORDS.orderTracking)) return 'ORDER_TRACKING';
  if (hasAny(msg, KEYWORDS.price)) return 'STRATEGIC_DIRECTION';
  if (hasAny(msg, KEYWORDS.shipping)) return 'SHIPPING_INFO';
  if (hasAny(msg, KEYWORDS.store)) return 'PHYSICAL_STORE';

  // Cliente directo: menciona un tipo de producto concreto → recomendar ya
  if (detectProductTypes(msg).length > 0) return 'RECOMMEND';

  if (hasAny(msg, KEYWORDS.gift) || hasAny(msg, KEYWORDS.couple)) return 'GUIDED_FANTASY';

  const isShortGreeting = hasAny(msg, KEYWORDS.greeting) && msg.length < 30;
  if (messageCount === 0 || (isShortGreeting && messageCount < 4)) return 'WELCOME';

  if (hasAny(msg, KEYWORDS.catalog)) return 'DISCOVERY';
  if (hasAny(msg, KEYWORDS.thanks) && msg.length < 40) return 'FAREWELL';

  if (sale.interestProducts?.length && messageCount >= 6) return 'STRATEGIC_DIRECTION';
  if (messageCount < 3) return 'DISCOVERY';
  return 'RECOMMEND';
}

/**
 * Genera instrucciones adicionales según el flujo activo
 */
function getFlowInstructions(flow) {
  const instructions = {
    WELCOME: `FLUJO ACTUAL: BIENVENIDA (Etapa 1 · Conectar)
- Saluda con calidez y preséntate brevemente como Sofía, asesora de Fantasías con asistencia en sexología.
- Termina con UNA pregunta de intención: "¿Buscas algo para ti o para sorprender a alguien?" o "¿Ya tienes algo en mente o prefieres que te asesore?".
- Si el cliente ya pidió un producto en su primer mensaje, NO esperes: salúdalo y pasa directo a recomendar (Etapa 3).
- Si no conoces su nombre, puedes preguntarlo con naturalidad ("¿Con quién tengo el gusto?"), pero no lo conviertas en un requisito.`,

    DISCOVERY: `FLUJO ACTUAL: DESCUBRIMIENTO (Etapa 2 · Descarte)
- Haz UNA sola pregunta de descarte que acerque a la recomendación.
- Si pide "catálogo" o "qué tienen": NO mandes lista. Menciona 3 o 4 líneas de producto en una frase (juguetes, lubricantes, lencería, retardantes, feromonas...) y pregunta qué le llama más la atención o si es para él/ella o para regalar.
- Sé empático si notas timidez: "Tranquilo 💜 aquí todo es con total discreción".`,

    RECOMMEND: `FLUJO ACTUAL: RECOMENDACIÓN (Etapas 3 y 4)
- El cliente ya dio pistas de lo que busca. Si falta un dato clave, haz UNA pregunta de descarte; si no, RECOMIENDA YA.
- Recomienda máximo 1 o 2 productos del catálogo con la fórmula: producto + beneficio + sensación + pregunta. Incluye su [IMAGEN:url] si tiene.
- Si ya mostró interés en un producto, ofrece su complemento (ver COMPLEMENTOS SUGERIDOS) y pregunta: "¿Lo llevas solo o con el complemento?".
- Registra con [INTERES_PRODUCTO: ...] el producto que le guste y con [COMPLEMENTO_OFRECIDO: ...] lo que ofreces.`,

    GUIDED_FANTASY: `FLUJO ACTUAL: FANTASÍA GUIADA (regalo / pareja)
- Primero entiende la ocasión y cómo es la otra persona (¿abierta o más reservada?), con UNA pregunta a la vez.
- Si ya tienes el contexto, crea una fantasía POR PARTES (Ambiente → Emoción → Contacto → Producto), 2-3 líneas por parte, y valida: "¿Hasta ahí te gusta la idea?".
- Al final ofrece el combo de productos que hace realidad la fantasía (máximo 3-4 productos, del catálogo, complementos más baratos que el principal).
- Incluye siempre una frase de consentimiento y comodidad para ambos.
- Registra [CAPTURAR_INTENCION: regalo] o [CAPTURAR_INTENCION: pareja].`,

    STRATEGIC_DIRECTION: `FLUJO ACTUAL: DIRECCIÓN AL CIERRE
- El cliente muestra interés real (pregunta precio o ya lleva rato hablando de un producto).
- Da el precio con seguridad, acompañado del valor: "Tiene un valor de *$X* y está diseñado para...".
- Si no hay complemento ofrecido aún, ofrécelo ahora.
- Termina con una pregunta de cierre alternativa: "¿Lo llevas solo o con el complemento?" o "¿Prefieres contra entrega o link de pago?".`,

    OBJECTION: `FLUJO ACTUAL: MANEJO DE OBJECIÓN (Etapa 5)
- El cliente puso un freno (precio, pensarlo, duda, vergüenza, discreción). NO te rindas y NO presiones.
- Valida su sentimiento en una línea ("Te entiendo 💜") y responde con el guion de objeción correspondiente del método.
- Precio: ofrece la alternativa más económica del mismo tipo que exista en el catálogo o deja solo lo esencial del combo.
- "Lo voy a pensar": ancla la recomendación con nombre y precio y ofrece dejarla apartada hoy.
- Termina con una pregunta fácil de responder que mantenga viva la venta.
- Registra [OBJECION: tipo].`,

    ORDER_TRACKING: `FLUJO ACTUAL: SEGUIMIENTO Y GUÍA DE PEDIDO
- El cliente está preguntando por el estado de su pedido o el número de guía.
- Revisa la sección ## ESTADO DEL ÚLTIMO PEDIDO DEL CLIENTE.
- Si tiene pedido registrado: dale el estado actual de forma clara y amable. Si ya tiene número de guía, compárteselo (*guía*) e indícale que viaja con empaque 100% discreto.
- Si aún no tiene guía asignada, dile con tranquilidad que su pedido ya está registrado y en empaque/alistamiento para ser entregado a la transportadora, y que apenas tengamos la guía se la compartiremos.
- Si NO tiene ningún pedido registrado en el sistema, pídele amablemente su nombre completo o el comprobante para verificar con el área de despachos.`,

    SHIPPING_INFO: `FLUJO ACTUAL: INFORMACIÓN DE ENVÍO
- Responde clara y brevemente con la INFORMACIÓN LOGÍSTICA (envío discreto, contraentrega solo en Popayán, Pitalito, Florencia y Yopal dentro de la ciudad, resto por transportadora con link de pago) y el COSTO DE ENVÍO que le corresponde según su ciudad.
- Si no sabes su ciudad, pregúntala: "¿Desde qué ciudad nos escribes?".
- Después de responder, retoma la venta: si ya hay producto de interés, pregunta si se lo dejas listo; si no, pregunta qué está buscando.`,

    CLOSING: `FLUJO ACTUAL: CIERRE DE VENTA (Etapa 7)
- **PRIMERO VERIFICA**: ¿Tienes DIRECCIÓN ([CAPTURAR_DIRECCION]) y CIUDAD ([CAPTURAR_CIUDAD])? Si falta algo, pídelo con naturalidad (un dato por mensaje) antes de usar etiquetas de cierre.
- Confirma el/los producto(s), el envío según su ciudad y el total en COP en un resumen corto (productos + envío = total).
- Si aún no ofreciste complemento y el cliente no lo rechazó, ofrécelo UNA vez en una línea antes de cerrar ("¿Te lo agrego?").
- **PRIORIDAD DEL MÉTODO DE PAGO**: Si el cliente menciona 'nequi', 'daviplata', 'transferencia', 'tarjeta' o pago electrónico: usa [CERRAR_VENTA] (link Wompi), sin importar la ciudad.
- **CIERRE AUTOMÁTICO** cuando el cliente confirme la compra y ya tengas dirección y ciudad:
  * Si NO mencionó pago electrónico Y su ciudad es Pitalito, Florencia, Popayán o Yopal: usa [PEDIDO_CONTRAENTREGA:nombre_exacto_del_producto].
  * Si mencionó pago electrónico O su ciudad NO está en la lista: usa [CERRAR_VENTA:nombre_del_producto].
- Después de la etiqueta, NO digas "Pedido registrado". Di "Perfecto, procedo a registrar tu pedido..." o "Voy a generar tu link de pago..." y el sistema hace el resto.
- **REGLA CRÍTICA**: Sin dirección capturada con [CAPTURAR_DIRECCION], NO uses [CERRAR_VENTA] ni [PEDIDO_CONTRAENTREGA].`,

    CONTACT_REPLY: `FLUJO ACTUAL: RESPUESTA A CONTACTO
- El cliente responde a un mensaje previo que le enviaste.
- Recíbelo natural y, como comentario casual, invítalo a guardarte como "Sofía — Fantasías".
- Retoma la venta donde quedó: si había un producto de interés, recuérdalo con nombre y pregunta si se lo dejas listo.`,

    PHYSICAL_STORE: `FLUJO ACTUAL: INFORMACIÓN DE LOCALES
- El cliente pregunta por tiendas físicas: usa la sección ## LOCALES FÍSICOS (dirección, referencias, fachada).
- IMPORTANTE: Si está Yopal en los locales, menciona que está disponible solo por ahora esta semana y que avisamos si hay cambios.
- Luego ofrece dejarle el producto listo o enviárselo a domicilio con total discreción.`,

    ESCALATION: `FLUJO ACTUAL: ESCALAMIENTO A HUMANO
- El cliente quiere hablar con una persona o administrador, o está molesto.
- Confirma cortamente: "Entiendo perfectamente. Ya mismo te comunico con uno de nuestros asesores para ayudarte."
- NO des correos ni números. Solo di que ya los pasas.
- Responde con [ESCALAR] al final de tu mensaje`,

    POLL: `FLUJO ACTUAL: POLLA MUNDIALISTA
- El cliente pregunta por la polla mundialista, fútbol, mundial o temas relacionados.
- Responde con entusiasmo y calidez. SIEMPRE incluye el link: https://polla.fantasias.com.co
- Sé breve y directo: NO vendas productos en este momento.
- Ejemplo: "¡Claro que sí! 🏆 Participa en nuestra polla mundialista y compite con otros fans. Entra aquí 👉 https://polla.fantasias.com.co ¿En qué más te puedo ayudar?"`,

    FAREWELL: `FLUJO ACTUAL: DESPEDIDA (Etapa 8 · Fidelizar)
- Agradece con calidez.
- Si compró: confirma que su pedido está en proceso e invítalo a guardarte como "Sofía — Fantasías" para ver tips y novedades (VIP si superó $150.000).
- Si NO compró y había un producto de interés: déjalo anclado en una línea ("Te dejo presente el *Nombre*, cuando quieras te lo aparto 💜").`,
  };

  return instructions[flow] || instructions.RECOMMEND;
}

module.exports = { detectFlow, getFlowInstructions };

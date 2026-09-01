const { openai, MODEL, MODEL_CHAIN } = require('../config/openai');
const { buildSystemPrompt, buildEmployeePrompt, buildAdminPrompt } = require('../ai/personality');
const { detectFlow, getFlowInstructions } = require('../ai/flows');
const { classifyClient, getRecommendedCategories, getProductLimit } = require('../ai/decisionEngine');
const { prisma } = require('../config/database');
const catalogService = require('./catalogService');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────
//  HELPERS: Rate-limit / fallback / streaming
// ─────────────────────────────────────────────────────────

class SofiaAIError extends Error {
  constructor(message, code = 'AI_ERROR', status = 500) {
    super(message);
    this.name = 'SofiaAIError';
    this.code = code;
    this.status = status;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err?.error?.status || err?.response?.status;
  if (status === 429) return true;
  const code = err.code || err.error?.code || err.type;
  if (code === 'RATE_LIMIT' || code === 'rate_limit_exceeded' || code === 'insufficient_quota') return true;
  const msg = (err.message || err.error?.message || '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded') || msg.includes('rate_limit');
}

function getRetryAfterMs(err, attempt) {
  const header = err?.headers?.['retry-after'] || err?.response?.headers?.['retry-after'] || err?.error?.headers?.['retry-after'];
  if (header) {
    const secs = parseInt(header, 10);
    if (!isNaN(secs)) return secs * 1000;
  }
  // backoff exponencial + jitter: 800ms, 1800ms, 4000ms
  const base = Math.min(800 * Math.pow(2, attempt), 5000);
  return base + Math.floor(Math.random() * 400);
}

function wrapOpenRouterError(err) {
  if (isRateLimitError(err)) {
    const wrapped = new SofiaAIError(
      'Sofia esta muy solicitada en este momento. Espera unos segundos e intenta de nuevo.',
      'RATE_LIMIT',
      429
    );
    wrapped.cause = err;
    wrapped.retryable = true;
    return wrapped;
  }
  // Otros errores de proveedor: marcarlos para log pero no exponer stack crudo al cliente
  const wrapped = new SofiaAIError(err.message || 'Error del proveedor IA', err.code || 'PROVIDER_ERROR', err.status || 500);
  wrapped.cause = err;
  wrapped.retryable = err.status >= 500 || err.status === 408;
  return wrapped;
}

function getFallbackTemplate(type = 'chat') {
  if (type === 'fantasy') {
    return (
      '✨ *Mientras Sofía retoma la inspiración...* ✨\n\n' +
      'Imagina una noche donde cada detalle está pensado para ustedes dos: luz tenue, aroma suave y un toque de sorpresa. 🌹\n\n' +
      'En *Fantasías: más allá de tu imaginación* tenemos el complemento perfecto para ese momento — cuéntame qué te provoca más curiosidad (¿algo suave y romántico o una experiencia más intensa?) y te recomiendo 1 opción ideal en segundos.\n\n' +
      '_Sofía está volviendo en unos instantes — ¿me cuentas qué te gustaría explorar?_ 💫'
    );
  }
  // plantilla general de respaldo para chat
  return (
    '¡Hola! Soy Sofía de *Fantasías* 🌹 Un instante — estoy con alta demanda y vuelvo contigo en segundos.\n\n' +
    'Mientras tanto cuéntame: ¿buscas algo para *disfrutar en pareja*, *sorprender* o *explorar algo nuevo*? Así te recomiendo la mejor opción en cuanto me reconecte. ✨'
  );
}

/**
 * Llama a openai.chat.completions.create con fallback de modelos y retry con backoff.
 * - Prueba MODEL_CHAIN en orden (gpt-4o -> gpt-4o-mini -> etc)
 * - En 429 hace backoff y pasa al siguiente modelo
 * - En 5xx/timeout reintenta mismo modelo 1 vez antes de cambiar
 */
async function callChatWithFallback(messages, opts = {}) {
  const { temperature = 0.7, max_tokens = 600, response_format } = opts;
  let lastError = null;

  for (let mIdx = 0; mIdx < MODEL_CHAIN.length; mIdx++) {
    const model = MODEL_CHAIN[mIdx];
    const maxRetriesForModel = 2; // intentos por modelo

    for (let attempt = 0; attempt < maxRetriesForModel; attempt++) {
      try {
        if (mIdx > 0 && attempt === 0) {
          logger.warn(`🔄 [FALLBACK] Modelo ${MODEL} agotado. Probando siguiente modelo: ${model} (intento ${mIdx + 1}/${MODEL_CHAIN.length})`);
        }
        const completionPromise = openai.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens,
          ...(response_format ? { response_format } : {}),
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenAI timeout: la respuesta tardó más de 30 segundos')), 30000)
        );
        const completion = await Promise.race([completionPromise, timeoutPromise]);
        if (mIdx > 0) logger.info(`✅ [FALLBACK-OK] Modelo ${model} respondió correctamente`);
        return completion;
      } catch (err) {
        lastError = err;
        const rateLimited = isRateLimitError(err);
        const isTimeout = err.message && err.message.includes('timeout');

        if (rateLimited) {
          logger.warn(`⚠️ [RATE_LIMIT] ${model} rate-limited (intento ${attempt + 1}/${maxRetriesForModel}): ${err.message?.substring(0, 120)}`);
          // Si es rate-limit, esperar y pasar al siguiente modelo directamente (no reintentar mismo modelo mucho)
          if (attempt < maxRetriesForModel - 1) {
            await sleep(getRetryAfterMs(err, attempt));
            continue;
          } else {
            // Agotados los intentos de este modelo -> siguiente modelo
            await sleep(getRetryAfterMs(err, attempt));
            break;
          }
        }

        if (isTimeout || err.status >= 500) {
          logger.warn(`⚠️ [RETRY] ${model} error transitorio (${err.message?.substring(0, 80)}), reintentando ${attempt + 1}/${maxRetriesForModel}`);
          if (attempt < maxRetriesForModel - 1) {
            await sleep(getRetryAfterMs(err, attempt));
            continue;
          }
          break;
        }

        // Error no recuperable -> no reintentar, probar siguiente modelo solo si es 429-like
        throw wrapOpenRouterError(err);
      }
    }
  }

  // Todos los modelos agotados
  throw wrapOpenRouterError(lastError || new Error('Todos los modelos IA agotados'));
}

/**
 * Streaming con fallback: intenta stream con MODEL_CHAIN. Si falla con rate-limit, prueba siguiente modelo.
 * Llama a onChunk(textDelta) por cada delta.
 * Retorna { fullText, modelUsed, usage }
 */
async function streamFantasyStory(messages, onChunk, opts = {}) {
  const { temperature = 0.8, max_tokens = 800 } = opts;
  let lastError = null;

  for (let mIdx = 0; mIdx < MODEL_CHAIN.length; mIdx++) {
    const model = MODEL_CHAIN[mIdx];
    try {
      if (mIdx > 0) logger.warn(`🔄 [STREAM-FALLBACK] Probando ${model} (stream ${mIdx + 1}/${MODEL_CHAIN.length})`);

      const stream = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens,
        stream: true,
      });

      let fullText = '';
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          if (typeof onChunk === 'function') {
            try { await onChunk(delta, fullText); } catch (_) {}
          }
        }
      }
      if (!fullText.trim()) throw new Error('Stream vacío');
      return { fullText, modelUsed: model, usage: null };
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err)) {
        logger.warn(`⚠️ [STREAM RATE_LIMIT] ${model}: ${err.message?.substring(0, 100)} — probando siguiente modelo`);
        await sleep(getRetryAfterMs(err, mIdx));
        continue; // siguiente modelo
      }
      // timeout / 5xx -> reintentar siguiente modelo también
      if (err.status >= 500 || (err.message && err.message.includes('timeout'))) {
        logger.warn(`⚠️ [STREAM RETRY] ${model} error transitorio: ${err.message}`);
        await sleep(600);
        continue;
      }
      throw wrapOpenRouterError(err);
    }
  }

  throw wrapOpenRouterError(lastError || new Error('IA no disponible en stream de descubrimiento'));
}

/**
 * Wrapper validado para historias/fantasías usado por chat.controller.js#streamValidatedStoryFlow
 * Nunca lanza RATE_LIMIT al cliente: si todos los modelos fallan, retorna plantilla de respaldo.
 */
async function streamValidatedStoryFlow({ messages, onChunk, fallbackType = 'fantasy', temperature, max_tokens }) {
  try {
    return await streamFantasyStory(messages, onChunk, { temperature, max_tokens });
  } catch (err) {
    const wrapped = isRateLimitError(err) || err.code === 'RATE_LIMIT' ? err : wrapOpenRouterError(err);
    if (wrapped.code === 'RATE_LIMIT' || wrapped.retryable) {
      logger.warn(`⚠️ [STREAM-FALLBACK-TEMPLATE] Usando plantilla de respaldo tras agotar modelos: ${wrapped.message}`);
      const template = getFallbackTemplate(fallbackType);
      // Simular streaming de la plantilla para que el front no vea corte
      if (typeof onChunk === 'function') {
        // Enviar en 2 chunks para parecer stream
        const mid = Math.floor(template.length / 2);
        await onChunk(template.substring(0, mid), template.substring(0, mid));
        await sleep(300);
        await onChunk(template.substring(mid), template);
      }
      return { fullText: template, modelUsed: 'fallback-template', usage: null, isFallback: true };
    }
    throw wrapped;
  }
}

class AIService {
  /**
   * Genera un audio a partir de texto usando OpenAI TTS
   * @param {string} text - El texto que Sofía dirá
   * @returns {string|null} - Ruta al archivo de audio temporal
   */
  async generateAudio(text) {
    try {
      const speechFile = path.resolve(`./temp_audio_${Date.now()}.ogg`);
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "shimmer", // Voz cálida y profesional
        input: text,
        response_format: "opus" // Formato ideal para notas de voz de WhatsApp
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      await fs.promises.writeFile(speechFile, buffer);
      return speechFile;
    } catch (error) {
      logger.error('Error generando audio TTS:', error);
      return null;
    }
  }

  // Exponer helpers para compatibilidad con código que importaba desde /dist/services/ai/aiService.js
  wrapOpenRouterError(err) { return wrapOpenRouterError(err); }
  async streamFantasyStory(messages, onChunk, opts) { return streamFantasyStory(messages, onChunk, opts); }
  async streamValidatedStoryFlow(args) { return streamValidatedStoryFlow(args); }
  getFallbackTemplate(type) { return getFallbackTemplate(type); }

  /**
   * Genera una respuesta de la IA para un mensaje del cliente
   */
  async generateResponse(userMessage, contact, messageHistory = [], branchId = null, hasRecentHumanIntervention = false, mediaData = null) {
    try {
      // 1. Detectar flujo conversacional
      const flow = detectFlow(userMessage || (mediaData ? "[Imagen recibida]" : ""), {
        messageCount: messageHistory.length,
        clientType: contact?.clientType,
      });

      // 2. Clasificar cliente
      let classification = null;
      if (messageHistory.length >= 2) {
        try {
          classification = await classifyClient(messageHistory);
        } catch (e) {
          logger.warn('⚠️ classifyClient falló, usando fallback:', e.message);
        }
      }

      // 3. Obtener productos y SUCURSALES cercanas
      const clientType = classification?.clientType || contact?.clientType || 'NUEVO';
      const confidenceLevel = classification?.confidenceLevel || contact?.confidenceLevel || 'BAJO';
      const categories = getRecommendedCategories(clientType);
      const productLimit = getProductLimit(confidenceLevel);
      
      const effectiveBranchId = branchId || messageHistory[0]?.branchId || contact?.branchId;
      
      let specificProducts = [];
      const recentMessages = messageHistory.slice(-3).map(m => m.content).join(' ');
      const searchContext = `${userMessage || ''} ${recentMessages}`.toLowerCase();
      
      const targetKeywords = ['retardante', 'lubricante', 'feromona', 'vibrador', 'lenceria', 'potencializador', 'crema', 'spray'];
      const foundTargetKeywords = targetKeywords.filter(k => searchContext.includes(k));
      
      const keywords = (userMessage || '').split(' ').filter(word => word.length > 3);
      const allKeywords = [...new Set([...keywords, ...foundTargetKeywords])];

      if (allKeywords.length > 0) {
        specificProducts = await prisma.product.findMany({
          where: {
            branchId: effectiveBranchId,
            isAvailable: true,
            OR: [
              ...allKeywords.map(k => ({ name: { contains: k } })),
              ...allKeywords.map(k => ({ description: { contains: k } })),
              ...allKeywords.map(k => ({ emotionalDesc: { contains: k } }))
            ]
          },
          take: 8
        });
      }

      let products = await catalogService.getProductsByCategories(categories, productLimit, effectiveBranchId);
      
      const seenIds = new Set(specificProducts.map(p => p.id));
      products = [...specificProducts, ...products.filter(p => !seenIds.has(p.id))];
      products = products.sort((a, b) => Number(b.price) - Number(a.price));
      
      if (searchContext.includes('retardante') && !products.some(p => (p.name + p.description).toLowerCase().includes('retardante'))) {
          const fallbackProducts = await prisma.product.findMany({
              where: { 
                  branchId: effectiveBranchId,
                  isAvailable: true,
                  OR: [
                      { description: { contains: 'retard' } },
                      { name: { contains: 'retard' } }
                  ]
              },
              take: 5
          });
          products = [...fallbackProducts, ...products];
      }

      // 4-6. Info sucursal, proximidad, lastOrder, systemPrompt
      const currentBranch = branchId ? await prisma.branch.findUnique({ where: { id: branchId } }) : null;
      const branches = await prisma.branch.findMany({
        where: { isAuthorized: true, isActive: true }
      });
      const closestBranch = this.findClosestBranch(contact, branches);
      const lastOrder = contact?.id ? await prisma.order.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        select: { shippingAddress: true, shippingCity: true }
      }) : null;

      const allBranches = await prisma.branch.findMany({
        where: { isAuthorized: true, isActive: true },
        select: {
          id: true, name: true, city: true, address: true,
          referencePoint: true, notes: true, storeFrontDesc: true,
        },
      });

      const systemPrompt = buildSystemPrompt(
        {
          name: contact?.name,
          city: contact?.city,
          clientType,
          purchaseStage: classification?.purchaseStage || contact?.purchaseStage || 'CURIOSO',
          closestBranch: closestBranch ? `${closestBranch.name} (${closestBranch.address})` : 'nuestra sede principal',
          lastOrderAddress: lastOrder?.shippingAddress,
          lastOrderCity: lastOrder?.shippingCity
        },
        products,
        currentBranch || closestBranch || {},
        allBranches
      );

      const flowInstructions = getFlowInstructions(flow);
      let continuityContext = '';
      if (hasRecentHumanIntervention || messageHistory.length > 3) {
        continuityContext = `\n\n## ⚠️ CONTINUIDAD DE CONVERSACIÓN (CRÍTICO)
- Ya hay una conversación en curso con este cliente. ANALIZA TODO el historial anterior antes de responder.
- Si un compañero/asesor humano estuvo hablando con el cliente, CONTINÚA desde donde dejó la conversación. NO empieces con "Hola" ni te presentes de nuevo.
- Si ya se discutieron productos, precios o envío, NO repitas esa información a menos que el cliente la pida.
- Si el cliente ya dio su nombre, ciudad o dirección en mensajes previos, NO los vuelvas a preguntar.
- Sé consistente con lo que ya se le prometió o informó al cliente en mensajes anteriores.
- Tu rol es continuar la venta fluidamente como si fueras la misma persona que estuvo hablando.`;
      }

      // 8. Construir mensajes para OpenAI
      const messages = [
        { 
          role: 'system', 
          content: `${systemPrompt}\n\n${flowInstructions}${continuityContext}`
        },
      ];

      const recentHistory = messageHistory.slice(-20);
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'USER' ? 'user' : 'assistant',
          content: msg.content,
        });
      });

      // Manejo Multimodal (Vision)
      if (mediaData) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userMessage || 'He enviado esta foto, ¿qué me puedes decir de ella respecto a tus productos?' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaData.mimetype};base64,${mediaData.data}`,
              },
            },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userMessage });
      }

      // 9. Llamar a OpenAI con fallback + retry
      let completion;
      try {
        completion = await callChatWithFallback(messages, { temperature: 0.7, max_tokens: 600 });
      } catch (err) {
        const wrapped = err.code === 'RATE_LIMIT' ? err : wrapOpenRouterError(err);
        if (wrapped.code === 'RATE_LIMIT') {
          logger.warn(`⚠️ [RATE_LIMIT] Todos los modelos agotados para ${contact?.phone}. Usando plantilla de respaldo.`);
          // En lugar de lanzar SofiaAIError al controller, retornar respuesta de respaldo amable
          // El controller NO verá un throw; verá una respuesta normal con flujo FALLBACK
          return {
            response: getFallbackTemplate('chat'),
            flow: 'FALLBACK_RATE_LIMIT',
            actions: {},
            tokensUsed: 0,
            closestBranchId: closestBranch?.id,
            isFallback: true,
          };
        }
        throw wrapped;
      }

      const aiResponse = completion.choices[0].message.content.trim();
      const tokensUsed = completion.usage?.total_tokens || 0;

      const actions = this.parseActions(aiResponse);
      const cleanResponse = this.cleanResponse(aiResponse);

      if (products.length === 0) {
        logger.warn(`⚠️ Catálogo vacío para branch ${effectiveBranchId}. La IA responderá sin catálogo.`);
      }

      logger.info(`IA respondió [${flow}] a ${contact?.phone} (${tokensUsed} tokens)`);

      return {
        response: cleanResponse,
        flow,
        actions,
        tokensUsed,
        closestBranchId: closestBranch?.id
      };
    } catch (error) {
      // Si es RATE_LIMIT que escapó, convertir en fallback en vez de mensaje técnico
      if (isRateLimitError(error) || error.code === 'RATE_LIMIT') {
        logger.warn('⚠️ RATE_LIMIT en generateResponse catch final — devolviendo plantilla respaldo');
        return {
          response: getFallbackTemplate('chat'),
          flow: 'FALLBACK_RATE_LIMIT',
          actions: {},
          tokensUsed: 0,
        };
      }
      logger.error('Error generando respuesta IA:', error);
      return {
        response: '¡Hola! Disculpa, tuve un pequeño inconveniente técnico. 😅 ¿Podrías repetirme tu mensaje? Ya estoy lista para atenderte.',
        flow: 'ERROR',
        actions: {},
        tokensUsed: 0,
      };
    }
  }

  /**
   * MODO EMPLEADO: Genera una respuesta técnica para consultas internas
   */
  async generateEmployeeResponse(userMessage, branchId = null) {
    try {
      const allProducts = await catalogService.getAllProducts(branchId);
      
      const systemPrompt = buildEmployeePrompt({ branchId }, allProducts);

      let completion;
      try {
        completion = await callChatWithFallback(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          { temperature: 0.3, max_tokens: 600 }
        );
      } catch (err) {
        if (isRateLimitError(err) || err.code === 'RATE_LIMIT') {
          return { response: '🛠️ *MODO ASISTENTE INTERNO*\n\n' + getFallbackTemplate('chat'), actions: {}, tokensUsed: 0, isFallback: true };
        }
        throw err;
      }

      const aiResponse = completion.choices[0].message.content.trim();
      const actions = this.parseActions(aiResponse);
      const cleanResponse = this.cleanResponse(aiResponse);

      return {
        response: `🛠️ *MODO ASISTENTE INTERNO*\n\n${cleanResponse}`,
        actions,
        tokensUsed: completion.usage?.total_tokens || 0
      };
    } catch (error) {
      if (isRateLimitError(error) || error.code === 'RATE_LIMIT') {
        return { response: '🛠️ *MODO ASISTENTE INTERNO*\n\n' + getFallbackTemplate('chat'), actions: {}, tokensUsed: 0, isFallback: true };
      }
      logger.error('Error en generateEmployeeResponse:', error);
      return { response: '❌ Error consultando inventario interno.' };
    }
  }

  async generateAdminResponse(userMessage, branchId = null) {
    try {
      const allProducts = await catalogService.getAllProducts(branchId);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const whereBranch = branchId ? { branchId } : {};

      const todaySales = await prisma.order.aggregate({
        where: { ...whereBranch, status: 'PAID', createdAt: { gte: today } },
        _sum: { amount: true },
        _count: true,
      });

      const pendingOrders = await prisma.order.findMany({
        where: { ...whereBranch, status: 'PENDING' },
        include: { contact: { select: { name: true, phone: true } }, items: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const paidOrdersToday = await prisma.order.findMany({
        where: { ...whereBranch, status: 'PAID', createdAt: { gte: today } },
        include: { contact: { select: { name: true, phone: true } }, items: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const activeConversations = await prisma.conversation.count({
        where: { ...whereBranch, status: 'ACTIVE' },
      });

      const escalatedConversations = await prisma.conversation.count({
        where: { ...whereBranch, status: 'ESCALATED' },
      });

      const newContactsToday = await prisma.contact.count({
        where: { ...whereBranch, createdAt: { gte: today } },
      });

      const lowStockProducts = await prisma.product.findMany({
        where: { ...whereBranch, isAvailable: true, stock: { lte: 10 } },
        select: { name: true, stock: true, category: true },
        orderBy: { stock: 'asc' },
        take: 15,
      });

      const totalRevenue = await prisma.order.aggregate({
        where: { ...whereBranch, status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      });

      const businessData = {
        todayRevenue: todaySales._sum.amount ? parseFloat(todaySales._sum.amount) : 0,
        todayOrdersCount: todaySales._count || 0,
        pendingOrders: pendingOrders.map(o => ({
          id: o.id,
          client: o.contact?.name || 'Sin nombre',
          phone: o.contact?.phone || '',
          amount: parseFloat(o.amount),
          products: o.items.map(i => `${i.product?.name} x${i.quantity}`),
          city: o.shippingCity || '',
          address: o.shippingAddress || '',
        })),
        paidOrdersToday: paidOrdersToday.map(o => ({
          id: o.id,
          client: o.contact?.name || 'Sin nombre',
          amount: parseFloat(o.amount),
          products: o.items.map(i => `${i.product?.name} x${i.quantity}`),
        })),
        activeConversations,
        escalatedConversations,
        newContactsToday,
        lowStockProducts,
        totalRevenue: totalRevenue._sum.amount ? parseFloat(totalRevenue._sum.amount) : 0,
        totalOrdersAllTime: totalRevenue._count || 0,
      };

      const systemPrompt = buildAdminPrompt({ branchId }, allProducts, businessData);

      let completion;
      try {
        completion = await callChatWithFallback(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          { temperature: 0.3, max_tokens: 800 }
        );
      } catch (err) {
        if (isRateLimitError(err) || err.code === 'RATE_LIMIT') {
          return { response: '👑 *MODO ADMIN*\n\n' + getFallbackTemplate('chat'), actions: {}, tokensUsed: 0, isFallback: true };
        }
        throw err;
      }

      const aiResponse = completion.choices[0].message.content.trim();
      const actions = this.parseActions(aiResponse);
      const cleanResponse = this.cleanResponse(aiResponse);

      return {
        response: `👑 *MODO ADMIN*\n\n${cleanResponse}`,
        actions,
        tokensUsed: completion.usage?.total_tokens || 0
      };
    } catch (error) {
      if (isRateLimitError(error) || error.code === 'RATE_LIMIT') {
        return { response: '👑 *MODO ADMIN*\n\n' + getFallbackTemplate('chat'), actions: {}, tokensUsed: 0, isFallback: true };
      }
      logger.error('Error en generateAdminResponse:', error);
      return { response: '❌ Error consultando información.' };
    }
  }

  findClosestBranch(contact, branches) {
    if (!contact?.city || !branches.length) return branches[0] || null;
    const contactCity = contact.city.toLowerCase().trim();
    const exactMatch = branches.find(b => b.city.toLowerCase().trim() === contactCity);
    return exactMatch || branches[0];
  }

  parseActions(response) {
    const actions = {
      shouldEscalate: false,
      shouldCloseSale: false,
      shouldCreateContraEntrega: false,
      productToSell: null,
      deliveryOption: null 
    };

    if (response.includes('[ESCALAR]')) actions.shouldEscalate = true;
    if (response.includes('domicilio') && response.length < 500) actions.deliveryOption = 'DOMICILIO';
    
    const nameMatch = response.match(/\[CAPTURAR_NOMBRE:(.+?)\]/);
    if (nameMatch) {
      actions.capturedName = nameMatch[1].trim();
    }

    const cityMatch = response.match(/\[CAPTURAR_CIUDAD:(.+?)\]/);
    if (cityMatch) {
      actions.capturedCity = cityMatch[1].trim();
    }

    const addressMatch = response.match(/\[CAPTURAR_DIRECCION:(.+?)\]/);
    if (addressMatch) {
      actions.capturedAddress = addressMatch[1].trim();
    }

    const fullNameMatch = response.match(/\[CAPTURAR_NOMBRE_COMPLETO:(.+?)\]/);
    if (fullNameMatch) {
      actions.capturedFullName = fullNameMatch[1].trim();
    }

    const interestsMatch = response.match(/\[CAPTURAR_GUSTOS:(.+?)\]/);
    if (interestsMatch) {
      actions.capturedInterests = interestsMatch[1].trim();
    }

    const neighborhoodMatch = response.match(/\[CAPTURAR_BARRIO:(.+?)\]/);
    if (neighborhoodMatch) {
      actions.capturedNeighborhood = neighborhoodMatch[1].trim();
    }

    const deliveryPhoneMatch = response.match(/\[CAPTURAR_TELEFONO_ENTREGA:(.+?)\]/);
    if (deliveryPhoneMatch) {
      actions.capturedDeliveryPhone = deliveryPhoneMatch[1].trim();
    }

    const saleMatch = response.match(/\[CERRAR_VENTA:(.+?)\]/);
    if (saleMatch) {
      actions.shouldCloseSale = true;
      actions.productsToSell = saleMatch[1].split(',').map(p => p.trim());
    }

    const contraMatch = response.match(/\[PEDIDO_CONTRAENTREGA:(.+?)\]/);
    if (contraMatch) {
      actions.shouldCreateContraEntrega = true;
      actions.productsToSell = contraMatch[1].split(',').map(p => p.trim());
    }

    const imageMatches = response.match(/\[IMAGEN:(.+?)\]/g);
    if (imageMatches) {
      actions.images = imageMatches.map(m => m.match(/\[IMAGEN:(.+?)\]/)[1].trim());
    }

    return actions;
  }

  cleanResponse(response) {
    return response
      .replace(/\[([A-ZÁÉÍÓÚÑ_]+)(:[^\]]*?)?\]/gi, '')
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/(?<!\*)\*(?!\*)/g, (match, offset, str) => {
        return match;
      })
      .replace(/  +/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .replace(/https?:\/\/(res\.cloudinary\.com|[a-zA-Z0-9-]+\.cloudinary\.com)\/[^\s)]+/gi, '')
      .replace(/\bMedia:\s*/gi, '')
      .trim();
  }
}

module.exports = new AIService();
// Exportar también helpers para tests y para compatibilidad con dist/services/ai/aiService.js
module.exports.SofiaAIError = SofiaAIError;
module.exports.wrapOpenRouterError = wrapOpenRouterError;
module.exports.streamFantasyStory = streamFantasyStory;
module.exports.streamValidatedStoryFlow = streamValidatedStoryFlow;
module.exports.getFallbackTemplate = getFallbackTemplate;
module.exports.callChatWithFallback = callChatWithFallback;
module.exports.isRateLimitError = isRateLimitError;

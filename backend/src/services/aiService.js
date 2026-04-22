const { openai, MODEL } = require('../config/openai');
const { buildSystemPrompt, buildEmployeePrompt } = require('../ai/personality');
const { detectFlow, getFlowInstructions } = require('../ai/flows');
const { classifyClient, getRecommendedCategories, getProductLimit } = require('../ai/decisionEngine');
const { prisma } = require('../config/database');
const catalogService = require('./catalogService');
const logger = require('../utils/logger');

class AIService {
  /**
   * Genera una respuesta de la IA para un mensaje del cliente
   */
  async generateResponse(userMessage, contact, messageHistory = [], branchId = null) {
    try {
      // 1. Detectar flujo conversacional
      const flow = detectFlow(userMessage, {
        messageCount: messageHistory.length,
        clientType: contact?.clientType,
      });

      // 2. Clasificar cliente
      let classification = null;
      if (messageHistory.length >= 2) {
        classification = await classifyClient(messageHistory);
      }

      // 3. Obtener productos y SUCURSALES cercanas
      const clientType = classification?.clientType || contact?.clientType || 'NUEVO';
      const confidenceLevel = classification?.confidenceLevel || contact?.confidenceLevel || 'BAJO';
      const categories = getRecommendedCategories(clientType);
      const productLimit = getProductLimit(confidenceLevel);
      
      // Filtramos productos por la sucursal actual
      const effectiveBranchId = branchId || messageHistory[0]?.branchId || contact?.branchId;
      let products = await catalogService.getProductsByCategories(categories, productLimit, effectiveBranchId);
      products = products.sort((a, b) => Number(b.price) - Number(a.price));

      // 4. Obtener INFO de la sucursal actual
      const currentBranch = branchId ? await prisma.branch.findUnique({ where: { id: branchId } }) : null;

      // 5. Lógica de Proximidad: Obtener info de todas las sucursales autorizadas
      const branches = await prisma.branch.findMany({
        where: { isAuthorized: true, isActive: true }
      });
      const closestBranch = this.findClosestBranch(contact, branches);

      // 5b. Obtener última dirección de envío si existe
      const lastOrder = contact?.id ? await prisma.order.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        select: { shippingAddress: true, shippingCity: true }
      }) : null;

      // 6. Construir el system prompt con contexto de productos, sucursales y LOGÍSTICA
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
        currentBranch || closestBranch || {}
      );

      // 7. Agregar instrucciones del flujo actual
      const flowInstructions = getFlowInstructions(flow);

      // 8. Construir mensajes para OpenAI
      const messages = [
        { 
          role: 'system', 
          content: `${systemPrompt}\n\n${flowInstructions}`
        },
      ];

      const recentHistory = messageHistory.slice(-15);
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'USER' ? 'user' : 'assistant',
          content: msg.content,
        });
      });

      messages.push({ role: 'user', content: userMessage });

      // 9. Llamar a OpenAI
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 450,
      });

      const aiResponse = completion.choices[0].message.content.trim();
      const tokensUsed = completion.usage?.total_tokens || 0;

      const actions = this.parseActions(aiResponse);
      const cleanResponse = this.cleanResponse(aiResponse);

      // SEGURIDAD: Si no hay productos en la sede, forzamos escalado humano siempre
      if (products.length === 0) {
        logger.warn(`⚠️ Catálogo vacío para branch ${effectiveBranchId}. Forzando escalado.`);
        actions.shouldEscalate = true;
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
      logger.error('Error generando respuesta IA:', error);
      return {
        response: '¡Hola! Disculpa, estamos teniendo un problema técnico momentáneo. Un asesor humano te contactará de inmediato 😊',
        flow: 'ERROR',
        actions: { shouldEscalate: true },
        tokensUsed: 0,
      };
    }
  }

  /**
   * MODO EMPLEADO: Genera una respuesta técnica para consultas internas
   */
  async generateEmployeeResponse(userMessage, branchId = null) {
    try {
      // Obtenemos TODO el catálogo de la sucursal (o global si no hay ID)
      const allProducts = await catalogService.getAllProducts(branchId);
      
      const systemPrompt = buildEmployeePrompt({ branchId }, allProducts);

      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3, // Más preciso, menos creativo
      });

      const aiResponse = completion.choices[0].message.content.trim();
      const actions = this.parseActions(aiResponse);
      const cleanResponse = this.cleanResponse(aiResponse);

      return {
        response: `🛠️ *MODO ASISTENTE INTERNO*\n\n${cleanResponse}`,
        actions,
        tokensUsed: completion.usage?.total_tokens || 0
      };
    } catch (error) {
      logger.error('Error en generateEmployeeResponse:', error);
      return { response: '❌ Error consultando inventario interno.' };
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

    const neighborhoodMatch = response.match(/\[CAPTURAR_BARRIO:(.+?)\]/);
    if (neighborhoodMatch) {
      actions.capturedNeighborhood = neighborhoodMatch[1].trim();
    }

    const saleMatch = response.match(/\[CERRAR_VENTA:(.+?)\]/);
    if (saleMatch) {
      actions.shouldCloseSale = true;
      // Convertir a array de nombres, limpiando espacios
      actions.productsToSell = saleMatch[1].split(',').map(p => p.trim());
    }

    // Extraer imágenes
    const imageMatches = response.match(/\[IMAGEN:(.+?)\]/g);
    if (imageMatches) {
      actions.images = imageMatches.map(m => m.match(/\[IMAGEN:(.+?)\]/)[1].trim());
    }

    return actions;
  }

  cleanResponse(response) {
    return response
      .replace(/\[ESCALAR\]/g, '')
      .replace(/\[CERRAR_VENTA:.+?\]/g, '')
      .replace(/\[IMAGEN:.+?\]/g, '')
      .replace(/\[CAPTURAR_NOMBRE:.+?\]/g, '')
      .replace(/\[CAPTURAR_CIUDAD:.+?\]/g, '')
      .replace(/\[CAPTURAR_DIRECCION:.+?\]/g, '')
      .replace(/\[CAPTURAR_BARRIO:.+?\]/g, '')
      .trim();
  }
}

module.exports = new AIService();

// ─────────────────────────────────────────────────────────
//  CONTROLLER: Mensajes WhatsApp — Flujo principal
// ─────────────────────────────────────────────────────────
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const crmService = require('../services/crmService');
const wompiService = require('../services/wompiService');
const catalogService = require('../services/catalogService');
const { prisma } = require('../config/database');
const { isWorkingHours, formatCOP } = require('../utils/helpers');

class MessageController {
  constructor() {
    this.processedMessages = new Set();
    // Mutex por chat: evita que dos mensajes del mismo chat se procesen simultáneamente
    this.processingChats = new Set();
    // Marca de tiempo de arranque: ignorar mensajes viejos que llegan en ráfaga al reconectar
    this.bootTime = Date.now();
  }

  async handleIncomingMessage(msg, branchIdStr) {
    const branchId = branchIdStr ? parseInt(branchIdStr) : 1;
    const chatId = msg.from;
    const body = (msg.body || '').trim();
    const msgId = msg.id?._serialized || msg.id?.id || `${chatId}-${Date.now()}`;

    try {
      if (!chatId || chatId === 'status@broadcast' || chatId.includes('@g.us') || msg.fromMe || (!body && !msg.hasMedia)) return;

      // Procesar todos los mensajes sin importar la antigüedad para asegurar 100% de atención
      // El antiBanDelay se encarga de que las respuestas salgan a un ritmo seguro
      const msgTimestamp = msg.timestamp ? msg.timestamp * 1000 : Date.now();
      logger.info(`📩 [MSG-IN] Procesando mensaje de ${chatId} (Timestamp: ${new Date(msgTimestamp).toLocaleString()})`);

      if (this.processedMessages.has(msgId)) return;
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 60000);

      // Mutex por chat: si ya estamos procesando un mensaje de este chat, ignorar el duplicado
      if (this.processingChats.has(chatId)) {
        logger.info(`🔒 [SKIP-DUP] Ya se está procesando un mensaje de ${chatId}, ignorando duplicado.`);
        return;
      }
      this.processingChats.add(chatId);

      logger.info(`📨 [MSG-IN] ${chatId}: "${body.substring(0, 30)}..."`);

      // ── 1. ¿ES EMPLEADO? ────────────────────────────────────
      const cleanPhone = chatId.split('@')[0];
      const employee = await prisma.employeeAccess.findFirst({
        where: { phone: cleanPhone }
      });

      if (employee) {
        logger.info(`👷 [EMPLOYEE] Mensaje de ${employee.name} (${chatId})`);
        const employeeResponse = await aiService.generateEmployeeResponse(body, branchId);
        await whatsappService.sendMessage(branchId, chatId, employeeResponse.response);
        return;
      }

      // ── 1b. ¿ES EL DUEÑO/ADMIN? ─────────────────────────────
      const allBranches = await prisma.branch.findMany({
        select: { id: true, notificationPhone: true, adminLids: true }
      });

      // Check 1: Phone match
      let matchedAdmin = allBranches.find(b => {
        const phone = b.notificationPhone?.replace(/[^0-9]/g, '');
        return phone && phone === cleanPhone;
      });

      // Check 2: LID match (phone JID resuelto)
      if (!matchedAdmin) {
        matchedAdmin = allBranches.find(b => {
          try {
            const lids = JSON.parse(b.adminLids || '[]');
            return lids.some(e => {
              const lid = typeof e === 'string' ? e : e.lid;
              return lid === cleanPhone;
            });
          } catch { return false; }
        });
      }

      // Check 2b: LID match contra LID original (antes de resolución a teléfono)
      if (!matchedAdmin && msg._originalLid) {
        const originalClean = msg._originalLid.split('@')[0];
        matchedAdmin = allBranches.find(b => {
          try {
            const lids = JSON.parse(b.adminLids || '[]');
            return lids.some(e => {
              const lid = typeof e === 'string' ? e : e.lid;
              return lid === originalClean;
            });
          } catch { return false; }
        });
      }

      // Check 3: Comando /admin para registrar LID desde WhatsApp Web
      if (!matchedAdmin && body.trim().startsWith('/admin')) {
        const parts = body.trim().split(/\s+/);
        const targetPhone = parts[1]?.replace(/[^0-9]/g, '');
        if (targetPhone) {
          const targetBranch = allBranches.find(b => {
            const phone = b.notificationPhone?.replace(/[^0-9]/g, '');
            return phone === targetPhone;
          });
          if (targetBranch) {
            try {
              const currentLids = JSON.parse(targetBranch.adminLids || '[]');
              if (!currentLids.some(e => e.lid === cleanPhone)) {
                currentLids.push({ lid: cleanPhone, name: parts[2] || 'Admin' });
                await prisma.branch.update({
                  where: { id: targetBranch.id },
                  data: { adminLids: JSON.stringify(currentLids) }
                });
                await whatsappService.sendMessage(branchId, chatId, `✅ LID registrado correctamente para la sede ${targetBranch.id}. Ya puedes usar el bot como admin.`);
                logger.info(`👑 [ADMIN-REGISTER] LID ${cleanPhone} registrado vía comando /admin para sede ${targetBranch.id}`);
                return;
              } else {
                await whatsappService.sendMessage(branchId, chatId, `ℹ️ Tu LID ya está registrado para la sede ${targetBranch.id}.`);
                return;
              }
            } catch (e) {
              logger.error('Error registrando LID:', e);
            }
          } else {
            await whatsappService.sendMessage(branchId, chatId, `❌ No se encontró una sede con el número ${targetPhone}.`);
            return;
          }
        } else {
          await whatsappService.sendMessage(branchId, chatId, `📝 Para registrarte como admin, envía: /admin [tu número de WhatsApp]\nEjemplo: /admin 573166575904`);
          return;
        }
      }

      if (matchedAdmin) {
        logger.info(`👑 [ADMIN] Mensaje del dueño (${chatId}) - Branch ${matchedAdmin.id}`);
        const adminResponse = await aiService.generateAdminResponse(body, branchId);
        await whatsappService.sendMessage(branchId, chatId, adminResponse.response);
        return;
      }

      // ── 2. CRM Y CONVERSACIÓN ────────────────────────────────
      let contact = await crmService.findOrCreateContact(chatId, branchId);
      const conversation = await crmService.getActiveConversation(contact.id, branchId);

      // Capturar nombre push de WhatsApp automáticamente si el contacto no tiene nombre
      let pushName = msg._data?.notifyName || msg.notifyName || msg._data?.pushName;
      if (!pushName && typeof msg.getContact === 'function') {
        try {
          const contactObj = await msg.getContact();
          pushName = contactObj?.pushname || contactObj?.name;
        } catch (err) {
          logger.error(`❌ Error al obtener contacto de WhatsApp para ${chatId}:`, err);
        }
      }
      if (pushName && (!contact.name || contact.name === 'Sin nombre')) {
        await crmService.updateContactInfo(contact.id, { name: pushName });
        contact.name = pushName;
        logger.info(`📱 [PUSH-NAME] Nombre capturado automáticamente de WhatsApp: "${pushName}" para ${chatId}`);
      }


      // ── 3. VERIFICAR HORARIO LABORAL ────────────────────────
      const workingStatus = await isWorkingHours(branchId);
      if (!workingStatus.isWorking) {
        logger.info(`🌙 [OFF-HOURS] Mensaje recibido de ${chatId} (Razón: ${workingStatus.reason}). Guardando para mañana.`);
        
        // Guardar el mensaje del usuario ANTES de marcar pendiente
        await crmService.saveMessage(conversation.id, 'USER', body || "[Imagen]");
        
        // Marcar conversación como pendiente de respuesta offline
        const currentContext = conversation.context || {};
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { context: { ...currentContext, pendingOfflineReply: true } }
        });

        // No enviamos mensaje automático para evitar despertar/molestar al cliente de noche
        return;
      }

      if (conversation.status === 'ESCALATED' || conversation.status === 'PAUSED') {
        // Si lleva más de 10 minutos escalado sin respuesta humana, reactivar automáticamente
        const lastAssistantMsg = [...(conversation.messages || [])].reverse().find(m => m.role === 'ASSISTANT');
        const minutesSinceLastResponse = lastAssistantMsg 
          ? (Date.now() - new Date(lastAssistantMsg.createdAt).getTime()) / (1000 * 60)
          : 999;

        if (minutesSinceLastResponse > 10) {
          logger.info(`🔄 [AUTO-REACTIVATE] Chat ${chatId} escalado hace ${Math.round(minutesSinceLastResponse)}min sin respuesta humana. Reactivando bot.`);
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'ACTIVE' }
          });
          // Continuar el flujo normal en vez de hacer return
        } else {
          logger.info(`🤫 [MSG] Chat pausado/escalado para ${chatId} (${Math.round(minutesSinceLastResponse)}min). Esperando humano.`);
          await crmService.saveMessage(conversation.id, 'USER', body);
          return;
        }
      }

      let mediaData = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.mimetype.startsWith('image/')) {
            mediaData = {
              data: media.data,
              mimetype: media.mimetype
            };
            logger.info(`📸 [MEDIA] Imagen recibida de ${chatId} (${media.mimetype})`);
          }
        } catch (mediaError) {
          logger.error(`❌ Error descargando media de ${chatId}:`, mediaError);
        }
      }

      if (!body && !mediaData) return; // Si no hay texto ni imagen, no procesar

      await crmService.saveMessage(conversation.id, 'USER', body || "[Imagen]");
      const messageHistory = conversation.messages || [];

      const aiResult = await aiService.generateResponse(body, contact, messageHistory, branchId, false, mediaData);
      
      if (!aiResult?.response) {
        logger.warn(`⚠️ [MSG] IA no generó texto para ${chatId}`);
        return;
      }

      const actions = aiResult.actions || {};
      logger.debug(`🔍 [ACTIONS] Para ${chatId}: contraentrega=${actions.shouldCreateContraEntrega}, closeSale=${actions.shouldCloseSale}, productos=${JSON.stringify(actions.productsToSell)}, addr=${actions.capturedAddress}, city=${actions.capturedCity}`);

      // SAFETY NET ACTIVO: Si la IA dice en texto que va a registrar el pedido contraentrega pero no usó la etiqueta,
      // activar el pedido automáticamente extrayendo el producto del texto de la IA.
      // IMPORTANTE: Solo aplica para contraentrega. Si menciona Wompi/transferencia/link, NO activar contraentrega.
      if (!actions.shouldCreateContraEntrega && !actions.shouldCloseSale) {
        const aiText = (aiResult.response || '').toLowerCase();
        
        // Detectar si es pago por Wompi/transferencia (NO contraentrega)
        const isWompiPayment = (
          aiText.includes('link') || aiText.includes('wompi') || 
          aiText.includes('transferencia') || aiText.includes('pago online') ||
          aiText.includes('pago seguro') || aiText.includes('link de pago')
        );

        const impliesContraentrega = !isWompiPayment && (
          (aiText.includes('registrar tu pedido') || aiText.includes('contra entrega') || aiText.includes('contraentrega') || aiText.includes('pagar en efectivo') || aiText.includes('pago en efectivo')) &&
          (aiText.includes('dirección') || aiText.includes('entrega') || aiText.includes('enviar') || aiText.includes('pedido'))
        );

        // SAFETY NET para Wompi: si la IA habla de generar el link pero no usó [CERRAR_VENTA]
        const impliesWompiClose = isWompiPayment && (
          aiText.includes('voy a generar') || aiText.includes('proceder') || 
          aiText.includes('generar tu link') || aiText.includes('link de pago')
        );

        if (impliesContraentrega) {
          logger.warn(`⚠️ [SAFETY-NET] IA habla de contraentrega sin etiqueta — activando rescate automático. Texto: "${(aiResult.response || '').substring(0, 150)}"`);
          
          // Extraer nombre de producto del texto de la IA
          const aiFullText = aiResult.response || '';
          const productPatterns = [
            // Patrón 1: "- *Nombre Producto* por $precio"
            /[-•]\s*\*?([^*\n$]{5,60}?)\*?\s+por\s+\$/i,
            // Patrón 2: "pedido del/de Nombre Producto para/por/a/en/."
            /pedido\s+del?\s+([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+por|\s+a\s|\s+en\s|\.|,|\n)/i,
            // Patrón 3: "registrar.*pedido.*del Nombre" (orden flexible)
            /registrar[^.]*pedido[^.]*del?\s+([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+por|\s+a\s|\s+en\s|\.|,|\n)/i,
            // Patrón 4: "enviaremos/enviaré el/la Nombre para/a/por"
            /enviar(?:emos|é|ás)?\s+(?:el\s+|la\s+)?([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+a\s|\s+por|\s+en\s|\.|,|\n)/i,
            // Patrón 5: nombre con código de modelo (ej: "Vibrador Zenobia XHH-190854")
            /([A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s]{3,40}[A-Z0-9]{2,6}[-][A-Z0-9]{2,10})/,
          ];

          
          let rescuedProduct = null;
          for (const pattern of productPatterns) {
            const match = aiFullText.match(pattern);
            if (match && match[1]) {
              rescuedProduct = match[1].trim().replace(/[*_]/g, '');
              break;
            }
          }
          
          // Si no encontramos en la IA, buscar en el historial reciente
          if (!rescuedProduct) {
            const recentAI = messageHistory.filter(m => m.role === 'assistant').slice(-5);
            for (const msg of recentAI.reverse()) {
              for (const pattern of productPatterns) {
                const match = (msg.content || '').match(pattern);
                if (match && match[1]) {
                  rescuedProduct = match[1].trim().replace(/[*_]/g, '');
                  break;
                }
              }
              if (rescuedProduct) break;
            }
          }
          
          if (rescuedProduct) {
            logger.info(`✅ [SAFETY-NET] Producto rescatado: "${rescuedProduct}" — activando shouldCreateContraEntrega`);
            actions.shouldCreateContraEntrega = true;
            actions.productsToSell = [rescuedProduct];
          } else {
            logger.warn(`⚠️ [SAFETY-NET] No se pudo extraer el producto del texto. Se requerirá intervención manual.`);
            // Notificar al admin para que cierre manualmente
            try {
              const contactForNotif = contact;
              await whatsappService.notifyPhone(branchId, 
                `⚠️ *PEDIDO PERDIDO — ACCIÓN REQUERIDA*\n\nLa IA confirmó una venta en texto pero no registró el pedido.\n\n👤 *Cliente:* ${contactForNotif.name || 'Sin nombre'}\n📱 *WhatsApp:* ${contactForNotif.phone}\n\nTexto de la IA:\n"${(aiResult.response || '').substring(0, 300)}"`
              );
            } catch (notifErr) {
              logger.error('Error notificando admin en SAFETY-NET:', notifErr);
            }
          }
        }

        // SAFETY NET para Wompi: rescatar cierre de venta cuando la IA habla de link de pago sin [CERRAR_VENTA]
        if (impliesWompiClose) {
          logger.warn(`⚠️ [SAFETY-NET-WOMPI] IA habla de generar link de pago sin etiqueta [CERRAR_VENTA] — activando rescate. Texto: "${(aiResult.response || '').substring(0, 150)}"`);
          const aiFullTextW = aiResult.response || '';
          const wProductPatterns = [
            /[-•]\s*\*?([^*\n$]{5,60}?)\*?\s+por\s+\$/i,
            /pedido\s+del?\s+([A-Za-záéíóúÁÉÍÓÚñÑ0-9\s\-#\.]{5,60}?)(?:\s+para|\s+por|\s+a\s|\s+en\s|\.|,|\n)/i,
            /([A-Za-záéíóúÁÉÍÓÚñÑ][A-Za-záéíóúÁÉÍÓÚñÑ\s]{3,40}[A-Z0-9]{2,6}[-][A-Z0-9]{2,10})/,
          ];
          let wRescuedProduct = null;
          for (const pat of wProductPatterns) {
            const m = aiFullTextW.match(pat);
            if (m && m[1]) { wRescuedProduct = m[1].trim().replace(/[*_]/g, ''); break; }
          }
          if (!wRescuedProduct) {
            const recentAIW = messageHistory.filter(m => m.role === 'assistant').slice(-5);
            for (const msgW of recentAIW.reverse()) {
              for (const pat of wProductPatterns) {
                const m = (msgW.content || '').match(pat);
                if (m && m[1]) { wRescuedProduct = m[1].trim().replace(/[*_]/g, ''); break; }
              }
              if (wRescuedProduct) break;
            }
          }
          if (wRescuedProduct) {
            logger.info(`✅ [SAFETY-NET-WOMPI] Producto rescatado: "${wRescuedProduct}" — activando shouldCloseSale (Wompi)`);
            actions.shouldCloseSale = true;
            actions.productsToSell = [wRescuedProduct];
          }
        }
      }


      
      // Actualizar cliente
      const contactUpdates = {};
      if (actions.capturedName || actions.capturedFullName) contactUpdates.name = actions.capturedFullName || actions.capturedName;
      if (actions.capturedCity) contactUpdates.city = actions.capturedCity;
      if (actions.capturedAddress) contactUpdates.address = actions.capturedAddress;
      if (actions.capturedNeighborhood) contactUpdates.neighborhood = actions.capturedNeighborhood;
      if (actions.capturedInterests) contactUpdates.interests = actions.capturedInterests;
      if (actions.capturedDeliveryPhone) contactUpdates.deliveryPhone = actions.capturedDeliveryPhone;

      // FALLBACK: Si la IA intentó cerrar contraentrega/venta pero no capturó la dirección con etiqueta,
      // intentar rescatar la dirección que la IA menciona en su propio texto de respuesta.
      // Ej: "Estaremos enviando el producto a tu dirección en Calle 15E #31, Barrio Modelo"
      if ((actions.shouldCreateContraEntrega || actions.shouldCloseSale) && !contactUpdates.address && !contact.address) {
        const aiText = aiResult.response || '';
        // Buscar patrones de dirección en el texto de respuesta de la IA
        const addrInText = aiText.match(/(?:direcci[oó]n(?:\s+en)?|dirección\s+como|direcci[oó]n:\s*|enviar[^a]*a|enviando[^a]*a)\s*([A-Za-z0-9#\-\.° ,áéíóúÁÉÍÓÚñÑ]{8,80})/i);
        if (addrInText && addrInText[1]) {
          const rescued = addrInText[1].trim().replace(/[.,!?]+$/, '');
          logger.info(`🔍 [ADDR-RESCUE] Dirección rescatada del texto de IA: "${rescued}"`);
          contactUpdates.address = rescued;
        }
        // También intentar extraer del mensaje entrante del usuario
        const userAddrMatch = body.match(/(?:calle|carrera|avenida|diagonal|transversal|cl|kr|av|dg|tv)\s+[A-Za-z0-9#\-\.° ,áéíóúÁÉÍÓÚñÑ]{3,60}/i);
        if (!contactUpdates.address && userAddrMatch) {
          const rescued = userAddrMatch[0].trim();
          logger.info(`🔍 [ADDR-RESCUE] Dirección rescatada del mensaje del usuario: "${rescued}"`);
          contactUpdates.address = rescued;
        }
      }

      // FALLBACK: Si la IA mencionó una ciudad (Popayán, Pitalito, etc.) pero no usó [CAPTURAR_CIUDAD]
      if ((actions.shouldCreateContraEntrega || actions.shouldCloseSale) && !contactUpdates.city && !contact.city) {
        const ciudadesContraentrega = ['Popayán', 'Pitalito', 'Florencia', 'Yopal'];
        const bodyAndResponse = `${body} ${aiResult.response || ''}`;
        for (const ciudad of ciudadesContraentrega) {
          if (bodyAndResponse.toLowerCase().includes(ciudad.toLowerCase())) {
            logger.info(`🔍 [CITY-RESCUE] Ciudad rescatada del texto: "${ciudad}"`);
            contactUpdates.city = ciudad;
            break;
          }
        }
      }

      if (Object.keys(contactUpdates).length > 0) {
        await crmService.updateContactInfo(contact.id, contactUpdates);
        // Recargar contact para que los checks de dirección usen los datos frescos
        contact = await crmService.findOrCreateContact(chatId, branchId);
      }

      // VALIDACIÓN DE DIRECCIÓN PREVIA AL ENVÍO DE RESPUESTA
      // Si la IA intenta cerrar venta/contraentrega pero falta dirección/ciudad,
      // suprimimos la respuesta generada de la IA para evitar confirmaciones falsas.
      const finalAddress = contactUpdates.address || contact.address;
      const finalCity = contactUpdates.city || contact.city;
      const missingAddress = !finalAddress || finalAddress === 'Por confirmar';
      const missingCity = !finalCity || finalCity === 'Por confirmar';

      let aiResponseToSend = aiResult.response;
      if ((actions.shouldCreateContraEntrega || actions.shouldCloseSale) && (missingAddress || missingCity)) {
        logger.warn(`⚠️ [MSG-BLOCKED] IA intentó cerrar venta pero falta dirección/ciudad. Suprimiendo respuesta contradictoria.`);
        aiResponseToSend = null;
      }

      logger.info(`📤 [MSG-DEBUG] aiResponseToSend: ${aiResponseToSend ? 'SÍ tiene respuesta' : 'NULL — sin respuesta'}, shouldContraEntrega=${actions.shouldCreateContraEntrega}, shouldCloseSale=${actions.shouldCloseSale}, missingAddress=${missingAddress}, missingCity=${missingCity}`);

      if (aiResponseToSend) {
        // Separar mensaje largo en 2 envíos naturales (por párrafo, sin cortar palabras)
        const responseParts = this.splitMessageNaturally(aiResponseToSend);
        
        logger.info(`📤 [MSG-SEND] Preparando envío de ${responseParts.length} partes a ${chatId} (branch ${branchId})`);
        for (let i = 0; i < responseParts.length; i++) {
          logger.info(`📤 [MSG-SEND] Enviando parte ${i + 1}/${responseParts.length} (${responseParts[i].length} chars) a ${chatId}`);
          await whatsappService.sendMessage(branchId, chatId, responseParts[i]);
          // Pequeña pausa entre mensajes para simular escritura humana
          if (i < responseParts.length - 1) {
            await new Promise(r => setTimeout(r, 1200));
          }
        }
        logger.info(`✅ [MSG-SEND] Envío completado para ${chatId}`);
        await crmService.saveMessage(conversation.id, 'ASSISTANT', aiResponseToSend, null, aiResult.tokensUsed);
      } else {
        await crmService.saveMessage(conversation.id, 'ASSISTANT', '[Mensaje suprimido por validación de backend]', null, aiResult.tokensUsed);
      }

      // Clasificación
      if (actions.classification) await crmService.updateClassification(contact.id, actions.classification);

      // Imágenes
      if (actions.images?.length > 0) {
        for (const imgUrl of actions.images) {
          const cleanUrl = imgUrl.replace(/^Media:\s*/i, '');
          if (cleanUrl?.startsWith('http')) await whatsappService.sendMedia(branchId, chatId, cleanUrl);
        }
      }

      // ── CONTRAENTREGA ──────────────────────────────────────
      if (actions.shouldCreateContraEntrega && actions.productsToSell?.length > 0) {
        if (missingAddress) {
          logger.warn(`⚠️ [CONTRAENTREGA] Sin dirección para ${chatId} — bloqueando pedido`);
          const msgDir = '📍 Para registrar tu pedido necesito tu dirección completa. ¿En qué dirección te lo enviamos? 🏠';
          await whatsappService.sendMessage(branchId, chatId, msgDir);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgDir);
          return;
        }
        
        if (missingCity) {
          logger.warn(`⚠️ [CONTRAENTREGA] Sin ciudad para ${chatId} — bloqueando pedido`);
          const msgCity = '🏙️ ¿En qué ciudad te encuentras? Necesito confirmar la ciudad antes de registrar tu pedido.';
          await whatsappService.sendMessage(branchId, chatId, msgCity);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgCity);
          return;
        }

        logger.info(`📦 [CONTRAENTREGA] Procesando pedido contraentrega para ${chatId}`);
        const orderItems = [];
        let totalAmount = 0;
        const productNames = [];

        for (const pName of actions.productsToSell) {
          const product = await catalogService.findProductByName(pName, branchId);
          if (product) {
            const qty = product.parsedQuantity || 1;
            orderItems.push({ productId: product.id, quantity: qty, price: product.price });
            totalAmount += parseFloat(product.price) * qty;
            productNames.push(`${product.name}${qty > 1 ? ` x${qty}` : ''}`);
          }
        }

        if (orderItems.length === 0) {
          logger.error(`⚠️ [CONTRAENTREGA] No se encontraron productos en BD para: ${actions.productsToSell.join(', ')}`);
          const fallbackMsg = '⚠️ Hubo un problema identificando los productos en nuestro sistema. Un asesor revisará tu pedido en breve para confirmarlo manualmente.';
          await whatsappService.sendMessage(branchId, chatId, fallbackMsg);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', fallbackMsg);
          
          const cleanPhoneAlert = (contact.phone || chatId).replace(/@[a-z.]+$/i, '');
          const nameLabelAlert = contact.name && contact.name !== 'Sin nombre' ? contact.name : `Cliente ${cleanPhoneAlert}`;
          await whatsappService.notifyPhone(branchId, `⚠️ *ALERTA DE PEDIDO (Contraentrega)*\nEl bot no encontró los productos en la BD:\nProductos: ${actions.productsToSell.join(', ')}\nCliente: ${nameLabelAlert} (${cleanPhoneAlert})`);

          return;
        }

        if (orderItems.length > 0) {
          // Crear orden en BD con estado PENDING
          const order = await crmService.createOrder({
            contactId: contact.id,
            branchId,
            items: orderItems,
            amount: totalAmount,
            shippingCity: contactUpdates.city || contact.city || 'Por confirmar',
            shippingAddress: contactUpdates.address || contact.address || 'Por confirmar',
            status: 'PENDING'
          });

          // La IA ya informó al cliente que el pedido fue registrado.
          // No enviamos un segundo mensaje de confirmación para evitar confusión.
          logger.info(`✅ [CONTRAENTREGA] Pedido #${order.id} creado por $${totalAmount.toLocaleString('es-CO')} COP — sin doble confirmación al cliente.`);


          // Notificar al número central
          const cleanClientPhone = (contact.phone || chatId).replace(/@[a-z.]+$/i, '');
          const clientName = contact.name && contact.name !== 'Sin nombre' ? contact.name : `Cliente ${cleanClientPhone}`;
          const deliveryPhone = contactUpdates.deliveryPhone || contact.deliveryPhone || 'No proporcionado';
          const finalAddr = contactUpdates.address || contact.address;
          const finalCity = contactUpdates.city || contact.city;
          const hasAddr = finalAddr && finalAddr !== 'Por confirmar';
          const hasCity = finalCity && finalCity !== 'Por confirmar';
          const addrWarning = (!hasAddr || !hasCity)
            ? `\n⚠️ *DIRECCIÓN PENDIENTE — CONTACTAR AL CLIENTE*\n`
            : '';
          const centralMsg = `📦 *PEDIDO CONTRAENTREGA* 📦\n\n` +
            `👤 *Cliente:* ${clientName}\n` +
            `📱 *WhatsApp:* ${cleanClientPhone}\n` +
            `📞 *Teléfono para entrega:* ${deliveryPhone}\n` +
            `📦 *Productos:* ${productNames.join(', ')}\n` +
            `💰 *Total:* ${formatCOP(totalAmount)}\n\n` +
            `📍 *DIRECCIÓN DE ENTREGA:*\n` +
            `${hasAddr ? finalAddr : '❌ NO PROPORCIONADA — CONTACTAR AL CLIENTE'}\n` +
            `🏙️ *CIUDAD:* ${hasCity ? finalCity : '❌ NO PROPORCIONADA — CONTACTAR AL CLIENTE'}\n` +
            `${contactUpdates.neighborhood || contact.neighborhood ? `🏘️ *Barrio:* ${contactUpdates.neighborhood || contact.neighborhood}\n` : ''}` +
            `${addrWarning}` +
            `\n⚠️ *TIPO:* Contraentrega (pago en efectivo al recibir)`;

          await whatsappService.notifyPhone(branchId, centralMsg);

        }
      }

      // Cierre de venta Wompi
      if (actions.shouldCloseSale && actions.productsToSell?.length > 0) {
        if (missingAddress) {
          logger.warn(`⚠️ [WOMPI] Sin dirección para ${chatId} — bloqueando link de pago`);
          const msgDir = '📍 Para generar tu link de pago necesito tu dirección completa. ¿En qué dirección te lo enviamos? 🏠';
          await whatsappService.sendMessage(branchId, chatId, msgDir);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgDir);
          return;
        }
        
        if (missingCity) {
          logger.warn(`⚠️ [WOMPI] Sin ciudad para ${chatId} — bloqueando link de pago`);
          const msgCity = '🏙️ ¿En qué ciudad te encuentras? Necesito confirmar la ciudad antes de generar el link de pago.';
          await whatsappService.sendMessage(branchId, chatId, msgCity);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', msgCity);
          return;
        }

        logger.info(`💰 [SALE] Iniciando proceso de pago para ${chatId}`);
        const orderItems = [];
        let totalAmount = 0;
        const productNames = [];

        for (const pName of actions.productsToSell) {
          const product = await catalogService.findProductByName(pName, branchId);
          if (product) {
            const qty = product.parsedQuantity || 1;
            orderItems.push({ productId: product.id, quantity: qty, price: product.price });
            totalAmount += parseFloat(product.price) * qty;
            productNames.push(`${product.name}${qty > 1 ? ` x${qty}` : ''}`);
          }
        }

        if (orderItems.length === 0) {
          logger.error(`⚠️ [WOMPI] No se encontraron productos en BD para: ${actions.productsToSell.join(', ')}`);
          const fallbackMsg = '⚠️ Hubo un problema identificando los productos en nuestro sistema. Un asesor revisará tu pedido en breve para generar el link de pago manualmente.';
          await whatsappService.sendMessage(branchId, chatId, fallbackMsg);
          await crmService.saveMessage(conversation.id, 'ASSISTANT', fallbackMsg);
          
          await whatsappService.notifyPhone(branchId, `⚠️ *ALERTA DE PEDIDO (Wompi)*\nEl bot no encontró los productos en la BD:\nProductos: ${actions.productsToSell.join(', ')}\nCliente: ${contact.name} (${contact.phone})`);
          return;
        }

        if (orderItems.length > 0) {
          const reference = `PAY-${conversation.id}-${Date.now()}`;
          const cartData = {
            contactId: contact.id,
            branchId,
            items: orderItems,
            amount: totalAmount,
            shippingCity: contactUpdates.city || contact.city || 'Por confirmar',
            shippingAddress: contactUpdates.address || contact.address || 'Por confirmar'
          };

          // Guardar carrito pendiente en el contexto de la conversación
          const currentContext = conversation.context || {};
          const pendingCarts = currentContext.pendingCarts || {};
          pendingCarts[reference] = cartData;

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { context: { ...currentContext, pendingCarts } }
          });

          try {
            const wompiLink = await wompiService.generatePaymentLink({
              branchId,
              amount: totalAmount,
              name: `Pedido - ${contact.name || 'Cliente'}`,
              description: `Compra: ${productNames.join(', ')}`,
              reference
            });

            if (wompiLink?.url) {
              const paymentMsg = `✨ *¡Todo listo!* Aquí tienes tu link de pago seguro por *$${totalAmount.toLocaleString('es-CO')} COP*:\n\n🔗 ${wompiLink.url}\n\nConfírmame cuando lo realices para despachar tu pedido discreto. 🌹`;
              await whatsappService.sendMessage(branchId, chatId, paymentMsg);
              await crmService.saveMessage(conversation.id, 'ASSISTANT', paymentMsg);
            }
          } catch (err) {
            logger.error(`❌ [SALE-ERR] Wompi falló: ${err.message}`);
            const errorMsg = "Lo siento, tuve un pequeño problema técnico generando tu link de pago seguro. 😅 Dame un momento y ya te conecto con un compañero para que te ayude de inmediato.";
            await whatsappService.sendMessage(branchId, chatId, errorMsg);
            await crmService.saveMessage(conversation.id, 'ASSISTANT', errorMsg);
          }
        }
      }

      if (actions.shouldEscalate) await crmService.escalateConversation(conversation.id);

    } catch (error) {
      logger.error(`❌ [CRITICAL-ERR] ${chatId}: ${error.stack}`);
      whatsappService.sendMessage(branchId, chatId, 'Dame un momento... ¡Ya te conecto con un compañero! 😊').catch(() => {});
    } finally {
      // Siempre liberar el mutex del chat para permitir el siguiente mensaje
      this.processingChats.delete(chatId);
    }
  }
  /**
   * Divide un mensaje largo en 2 partes naturales, cortando por párrafo (\n\n)
   * sin cortar palabras ni frases. Mensajes cortos se dejan como están.
   */
  splitMessageNaturally(text) {
    // Si el mensaje es corto, no dividir
    if (!text || text.length < 120) return [text];
    
    // Separar por párrafos (doble salto de línea)
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    
    // Si solo hay un párrafo o no se pudo dividir
    if (paragraphs.length <= 1) return [text];
    
    // Agrupar párrafos muy cortos con el anterior para no enviar líneas huérfanas
    const parts = [];
    let current = '';
    
    for (const para of paragraphs) {
      if (current && (current.length + para.length) < 150) {
        // Juntar con el anterior si ambos son cortos
        current += '\n\n' + para;
      } else if (!current) {
        current = para;
      } else {
        parts.push(current);
        current = para;
      }
    }
    if (current) parts.push(current);
    
    // Si todo quedó en una sola parte, devolver como está
    if (parts.length <= 1) return [text];
    
    return parts;
  }
}

module.exports = new MessageController();

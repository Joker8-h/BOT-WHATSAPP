// ─────────────────────────────────────────────────────────
//  SERVICE: CRM — Gestión de contactos y conversaciones (Multi-sucursal)
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class CRMService {
  /**
   * Busca o crea un contacto por número de teléfono DENTRO de una sucursal
   */
  async findOrCreateContact(phone, branchId, name = null) {
    try {
      // El teléfono es ahora único globalmente en el CRM
      let contact = await prisma.contact.findUnique({
        where: { phone },
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            phone,
            branchId,
            name: name || null,
            clientType: 'NUEVO',
            confidenceLevel: 'BAJO',
            purchaseStage: 'CURIOSO',
          },
        });
        logger.info(`👤 Nuevo contacto creado en sucursal ${branchId}: ${phone}`);
      } else {
        // Actualizar último mensaje y nombre si no tenía
        const updates = { lastMessageAt: new Date() };
        if (name && !contact.name) updates.name = name;
        await prisma.contact.update({
          where: { id: contact.id },
          data: updates,
        });
      }

      return contact;
    } catch (error) {
      logger.error(`Error en findOrCreateContact (Branch ${branchId}):`, error);
      throw error;
    }
  }

  /**
   * Actualiza información específica del contacto capturada por la IA.
   * Si un campo falla (columna inexistente, valor inválido), se reintenta campo por
   * campo para NO perder los demás datos del cliente (dirección, ciudad, nombre...).
   */
  async updateContactInfo(contactId, data) {
    const ALLOWED = ['name', 'fullName', 'city', 'address', 'neighborhood', 'interests', 'deliveryPhone'];

    const payload = {};
    for (const field of ALLOWED) {
      const value = data[field];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        payload[field] = String(value).trim();
      }
    }

    if (Object.keys(payload).length === 0) return null;

    try {
      const updated = await prisma.contact.update({ where: { id: contactId }, data: payload });
      logger.info(`💾 [CRM] Datos guardados para contacto ${contactId}: ${Object.keys(payload).join(', ')}`);
      return updated;
    } catch (error) {
      logger.error(`Error actualizando contacto ${contactId} (${Object.keys(payload).join(', ')}). Reintentando campo por campo:`, error.message);

      // Fallback: guardar campo por campo para que un solo campo problemático
      // no arrastre consigo la dirección o la ciudad del pedido.
      let lastOk = null;
      for (const [field, value] of Object.entries(payload)) {
        try {
          lastOk = await prisma.contact.update({ where: { id: contactId }, data: { [field]: value } });
        } catch (fieldError) {
          logger.error(`❌ [CRM] No se pudo guardar "${field}" del contacto ${contactId}: ${fieldError.message}`);
        }
      }
      return lastOk;
    }
  }

  /**
   * Actualiza la clasificación del contacto
   */
  async updateClassification(contactId, classification) {
    try {
      if (!classification) return;
      return await prisma.contact.update({
        where: { id: contactId },
        data: {
          clientType: classification.clientType || undefined,
          confidenceLevel: classification.confidenceLevel || undefined,
          purchaseStage: classification.purchaseStage || undefined,
        },
      });
    } catch (error) {
      logger.error('Error actualizando clasificación:', error);
    }
  }

  /**
   * Obtiene o crea la conversación activa para un contacto en una sucursal específica
   */
  async getActiveConversation(contactId, branchId) {
    try {
      let conversation = await prisma.conversation.findFirst({
        where: {
          contactId,
          branchId,
          status: { in: ['ACTIVE', 'PAUSED'] },
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      });

      // Reordenar cronológicamente (la query trae desc para limitar a los últimos 20)
      if (conversation) conversation.messages = conversation.messages.reverse();

      if (!conversation) {
        // Recuperar el contexto de la última conversación cerrada del cliente
        // para no arrancar de cero (pedido en curso, datos ya capturados).
        const previous = await prisma.conversation.findFirst({
          where: { contactId, branchId },
          orderBy: { updatedAt: 'desc' },
          select: { context: true },
        });

        conversation = await prisma.conversation.create({
          data: {
            contactId,
            branchId,
            status: 'ACTIVE',
            context: this._carryOverContext(previous?.context),
          },
          include: {
            messages: true,
          },
        });
      }

      // Si la conversación tiene más de 24h sin mensajes, crear una nueva
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      if (lastMessage) {
        const hoursSinceLastMsg = (Date.now() - new Date(lastMessage.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastMsg > 24) {
          const carriedContext = this._carryOverContext(conversation.context);
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'CLOSED', endedAt: new Date() },
          });
          conversation = await prisma.conversation.create({
            // El pedido en curso viaja a la nueva conversación: el bot NUNCA olvida qué pidió.
            data: { contactId, branchId, status: 'ACTIVE', context: carriedContext },
            include: { messages: true },
          });
          logger.info(`🔄 [CRM] Nueva conversación ${conversation.id} para contacto ${contactId} — pedido en curso conservado.`);
        }
      }

      return conversation;
    } catch (error) {
      logger.error(`Error en getActiveConversation (Branch ${branchId}):`, error);
      throw error;
    }
  }

  /**
   * Conserva únicamente la memoria de venta al rotar de conversación.
   * Se descartan datos volátiles (carritos Wompi ya emitidos, banderas de horario).
   */
  _carryOverContext(context) {
    if (!context || typeof context !== 'object') return undefined;
    const carried = {};
    if (context.pedido) carried.pedido = context.pedido;
    if (context.pendingCarts && Object.keys(context.pendingCarts).length > 0) {
      carried.pendingCarts = context.pendingCarts;
    }
    return Object.keys(carried).length > 0 ? carried : undefined;
  }

  /**
   * Guarda/actualiza el "pedido en curso" del cliente dentro del contexto de la
   * conversación. Es la memoria que impide que el bot olvide qué se acordó.
   */
  async saveOrderDraft(conversationId, draft) {
    try {
      if (!draft || Object.keys(draft).length === 0) return null;

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { context: true },
      });

      const context = (conversation?.context && typeof conversation.context === 'object') ? conversation.context : {};
      const previous = context.pedido || {};

      const pedido = {
        ...previous,
        ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v !== null && v !== '')),
        actualizadoEn: new Date().toISOString(),
      };

      // Los productos se acumulan sin duplicados: si el cliente añadió algo antes,
      // sigue en el pedido aunque el último mensaje no lo mencione.
      if (draft.productos?.length) {
        const merged = [...(previous.productos || []), ...draft.productos]
          .map(p => String(p).trim())
          .filter(Boolean);
        pedido.productos = [...new Map(merged.map(p => [p.toLowerCase(), p])).values()];
      }

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { context: { ...context, pedido } },
      });

      return pedido;
    } catch (error) {
      logger.error(`Error guardando pedido en curso (conv ${conversationId}):`, error.message);
      return null;
    }
  }

  /**
   * Reúne todo lo que el sistema sabe del pedido del cliente: borrador en curso,
   * pedidos pendientes en BD y última compra. Se inyecta en el prompt de la IA.
   */
  async buildOrderMemory(contactId, conversation) {
    const memory = { draft: null, pendingOrders: [], lastPaidOrder: null };

    try {
      const context = (conversation?.context && typeof conversation.context === 'object') ? conversation.context : {};
      if (context.pedido) memory.draft = context.pedido;

      const orders = await prisma.order.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: { include: { product: { select: { name: true } } } } },
      });

      memory.pendingOrders = orders
        .filter(o => ['PENDING', 'PAYMENT_SENT'].includes(o.status))
        .map(o => ({
          id: o.id,
          amount: parseFloat(o.amount),
          status: o.status,
          createdAt: o.createdAt,
          products: o.items.map(i => `${i.product?.name || 'Producto'} x${i.quantity}`),
          address: o.shippingAddress,
          city: o.shippingCity,
        }));

      const paid = orders.find(o => ['PAID', 'SHIPPED', 'DELIVERED'].includes(o.status));
      if (paid) {
        memory.lastPaidOrder = {
          id: paid.id,
          amount: parseFloat(paid.amount),
          createdAt: paid.createdAt,
          products: paid.items.map(i => `${i.product?.name || 'Producto'} x${i.quantity}`),
          address: paid.shippingAddress,
          city: paid.shippingCity,
        };
      }
    } catch (error) {
      logger.error(`Error construyendo memoria de pedido (contacto ${contactId}):`, error.message);
    }

    return memory;
  }

  /**
   * Obtiene los últimos mensajes de una conversación para dar contexto a la IA
   */
  async getLastMessages(conversationId, limit = 10) {
    try {
      return await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error('Error en getLastMessages:', error);
      return [];
    }
  }

  /**
   * Guarda un mensaje en la conversación
   */
  async saveMessage(conversationId, role, content, waMessageId = null, tokensUsed = null) {
    try {
      const message = await prisma.message.create({
        data: {
          conversationId,
          role,
          content,
          waMessageId,
          tokensUsed,
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          messageCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      return message;
    } catch (error) {
      logger.error('Error guardando mensaje:', error);
    }
  }

  /**
   * Obtiene todos los contactos con filtros y aislamiento de sucursal
   */
  async getContacts({ branchId, page = 1, limit = 50, city, clientType, isActive, search }) {
    const where = {};
    if (branchId) where.branchId = branchId;
    if (city) where.city = city;
    if (clientType) where.clientType = clientType;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { lastMessageAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);

    return { contacts, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Obtiene conversaciones recientes filtradas por branch
   */
  async getRecentConversations(limit = 20, branchId = null) {
    const where = branchId ? { branchId } : {};
    return prisma.conversation.findMany({
      where,
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Obtiene métricas generales filtradas por branch
   */
  async getMetrics(branchId = null) {
    const filter = branchId ? { branchId } : {};
    const [totalContacts, activeContacts, todayConversations, totalOrders] = await Promise.all([
      prisma.contact.count({ where: filter }),
      prisma.contact.count({ where: { ...filter, isActive: true } }),
      prisma.conversation.count({
        where: {
          ...filter,
          startedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      prisma.order.count({ where: { ...filter, status: 'PAID' } }),
    ]);

    return { totalContacts, activeContacts, todayConversations, totalOrders };
  }

  /**
   * Crea una orden en la DB
   */
  async createOrder({ contactId, branchId, items, amount, shippingCity, shippingAddress, status = 'PENDING', paymentMethod = null, notes = null }) {
    try {
      return await prisma.order.create({
        data: {
          contactId,
          branchId,
          amount,
          status,
          shippingCity,
          shippingAddress,
          paymentMethod,
          notes,
          items: {
            create: items.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price
            }))
          }
        }
      });
    } catch (error) {
      logger.error('Error en crmService.createOrder:', error);
      throw error;
    }
  }

  /**
   * Escala una conversación a humano
   */
  async escalateConversation(conversationId) {
    try {
      return await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'ESCALATED' }
      });
    } catch (error) {
      logger.error('Error escalando conversación:', error);
    }
  }
}

module.exports = new CRMService();

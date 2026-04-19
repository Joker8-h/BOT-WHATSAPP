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
      // El teléfono es único por sucursal según el nuevo esquema
      let contact = await prisma.contact.findFirst({
        where: { phone, branchId },
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
   * Actualiza la clasificación del contacto
   */
  async updateClassification(contactId, classification) {
    try {
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
          status: 'ACTIVE',
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 50,
          },
        },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            contactId,
            branchId,
            status: 'ACTIVE',
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
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'CLOSED', endedAt: new Date() },
          });
          conversation = await prisma.conversation.create({
            data: { contactId, branchId, status: 'ACTIVE' },
            include: { messages: true },
          });
        }
      }

      return conversation;
    } catch (error) {
      logger.error(`Error en getActiveConversation (Branch ${branchId}):`, error);
      throw error;
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
}

module.exports = new CRMService();

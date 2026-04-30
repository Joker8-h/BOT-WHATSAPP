// ─────────────────────────────────────────────────────────
//  SERVICE: Campañas masivas
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const cron = require('node-cron');
const logger = require('../utils/logger');

class CampaignService {
  constructor() {
    this.whatsappService = null;
  }

  /**
   * Inyecta el servicio de WhatsApp (evita dependencia circular)
   */
  setWhatsAppService(waService) {
    this.whatsappService = waService;
  }

  /**
   * Crea una nueva campaña
   */
  async createCampaign({ name, message, targetFilter, scheduledAt }) {
    // Contar cuántos contactos aplican
    const whereFilter = this._buildFilter(targetFilter);
    const totalTargets = await prisma.contact.count({ where: whereFilter });

    const campaign = await prisma.campaign.create({
      data: {
        name,
        message,
        targetFilter: targetFilter || {},
        totalTargets,
        status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
    });

    logger.info(`📢 Campaña creada: "${name}" (${totalTargets} contactos)`);
    return campaign;
  }

  /**
   * Ejecuta una campaña
   */
  async executeCampaign(campaignId) {
    if (!this.whatsappService || !this.whatsappService.isReady) {
      logger.warn('⚠️ Campaña abortada: WhatsApp no está conectado o listo.');
      throw new Error('WhatsApp no está conectado o listo para enviar campañas.');
    }

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaña no encontrada');
    if (campaign.status === 'RUNNING') throw new Error('Campaña ya está en ejecución');

    // Marcar como en ejecución
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // Obtener contactos objetivo
    const whereFilter = this._buildFilter(campaign.targetFilter);
    whereFilter.isActive = true;
    whereFilter.isBlocked = false;
    const contacts = await prisma.contact.findMany({ where: whereFilter });

    // Enviar mensajes en background
    this._sendCampaignMessages(campaign.id, contacts, campaign.message, campaign.branchId)
      .catch(err => logger.error('Error en campaña:', err));

    return { totalTargets: contacts.length };
  }

  /**
   * Envía mensajes de campaña con control anti-ban
   */
  async _sendCampaignMessages(campaignId, contacts, message, branchId) {
    if (!branchId) {
      logger.error(`❌ Campaña ${campaignId} abortada: No tiene branchId asignado.`);
      return;
    }

    const results = await this.whatsappService.sendBulkMessages(branchId, contacts, message, 8000);

    const sentCount = results.filter(r => r.sent).length;
    const deliveredCount = sentCount; // Aproximación

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'COMPLETED',
        sentCount,
        deliveredCount,
        completedAt: new Date(),
      },
    });

    logger.info(`📢 Campaña ${campaignId} completada: ${sentCount}/${contacts.length} enviados`);
  }

  /**
   * Construye filtro Prisma desde el target
   */
  _buildFilter(targetFilter) {
    const where = {};
    if (!targetFilter) return where;

    if (targetFilter.city) where.city = targetFilter.city;
    if (targetFilter.clientType) where.clientType = targetFilter.clientType;
    if (targetFilter.minPurchases) where.totalPurchases = { gte: targetFilter.minPurchases };
    if (targetFilter.inactive) {
      where.lastMessageAt = {
        lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 días
      };
    }

    return where;
  }

  /**
   * Inicia el scheduler de campañas programadas
   */
  startScheduler() {
    // Cada 5 minutos, revisar si hay campañas programadas
    cron.schedule('*/5 * * * *', async () => {
      try {
        const pendingCampaigns = await prisma.campaign.findMany({
          where: {
            status: 'SCHEDULED',
            scheduledAt: { lte: new Date() },
          },
        });

        for (const campaign of pendingCampaigns) {
          logger.info(`⏰ Ejecutando campaña programada: ${campaign.name}`);
          await this.executeCampaign(campaign.id);
        }
      } catch (error) {
        logger.error('Error en scheduler de campañas:', error);
      }
    });

    logger.info('⏰ Scheduler de campañas iniciado');
  }

  /**
   * Obtiene todas las campañas
   */
  async getCampaigns() {
    return prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}

module.exports = new CampaignService();

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class MetricsController {
  /**
   * Obtiene métricas generales para el dashboard
   */
  async getDashboardStats(req, res) {
    try {
      const { branchId } = req.query;
      const where = branchId ? { branchId: parseInt(branchId) } : {};

      // 1. Ventas totales (Pagadas)
      const totalSales = await prisma.order.aggregate({
        where: { ...where, status: 'PAID' },
        _sum: { amount: true },
        _count: true
      });

      // 2. Ventas hoy
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todaySales = await prisma.order.aggregate({
        where: { 
          ...where, 
          status: 'PAID',
          createdAt: { gte: today }
        },
        _sum: { amount: true },
        _count: true
      });

      // 3. Conversaciones activas
      const activeConvs = await prisma.conversation.count({
        where: { ...where, status: 'ACTIVE' }
      });

      // 4. Nuevos contactos (Últimos 7 días)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const newContacts = await prisma.contact.count({
        where: { ...where, createdAt: { gte: sevenDaysAgo } }
      });

      res.json({
        success: true,
        data: {
          totalRevenue: totalSales._sum.amount || 0,
          totalOrders: totalSales._count || 0,
          todayRevenue: todaySales._sum.amount || 0,
          todayOrders: todaySales._count || 0,
          activeConversations: activeConvs,
          newContactsLastWeek: newContacts
        }
      });
    } catch (error) {
      logger.error('Error obteniendo stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Obtiene datos para el gráfico de ventas de la última semana
   */
  async getSalesChart(req, res) {
    try {
      const { branchId } = req.query;
      const days = [];
      const now = new Date();

      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const dayStats = await prisma.order.aggregate({
          where: {
            branchId: branchId ? parseInt(branchId) : undefined,
            status: 'PAID',
            createdAt: { gte: date, lt: nextDate }
          },
          _sum: { amount: true }
        });

        days.push({
          date: date.toLocaleDateString('es-CO', { weekday: 'short' }),
          amount: dayStats._sum.amount || 0
        });
      }

      res.json({ success: true, data: days });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new MetricsController();

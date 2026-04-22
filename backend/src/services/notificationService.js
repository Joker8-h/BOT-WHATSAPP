const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class NotificationService {
  /**
   * Envía una alerta de WhatsApp a todos los empleados configurados de la branch
   * @param {object} whatsappService — Instancia del servicio de WhatsApp
   * @param {number} branchId — ID de la sucursal que genera la alerta
   * @param {string} message — Contenido de la alerta
   */
  async notifyEmployees(whatsappService, branchId, message) {
    try {
      // 1. Obtener datos de la sucursal (para el grupo) y empleados
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { notificationGroupName: true, name: true }
      });

      const employees = await prisma.employeeAccess.findMany({
        where: { branchId }
      });

      const fullMessage = `🚨 *NOTIFICACIÓN FANTASÍAS* 🚨\n\n${message}`;

      // 2. Notificar al GRUPO de la sucursal (Si existe)
      if (branch?.notificationGroupName) {
        await whatsappService.notifyGroup(branchId, fullMessage);
      }

      // 3. Notificar a cada empleado INDIVIDUALMENTE
      if (employees.length > 0) {
        for (const employee of employees) {
          try {
            const phone = employee.phone;
            const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
            
            await whatsappService.sendMessage(branchId, formattedPhone, fullMessage);
            logger.info(`📢 Alerta enviada a empleado ${phone} (${employee.name})`);
          } catch (error) {
            logger.error(`❌ Error enviando alerta individual a ${employee.phone}:`, error);
          }
        }
      } else if (!branch?.notificationGroupName) {
        logger.warn(`⚠️ Sin medios de notificación para sucursal ${branchId} (No hay empleados ni grupo)`);
      }
    } catch (dbError) {
      logger.error('❌ Error consultando empleados para notificaciones:', dbError);
    }
  }
}

module.exports = new NotificationService();

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
      // 1. Obtener empleados autorizados de la DB para esta branch
      const employees = await prisma.employeeAccess.findMany({
        where: { branchId }
      });

      if (employees.length === 0) {
          logger.warn(`⚠️ No hay empleados configurados en la DB para la sucursal ${branchId}`);
          return;
      }

      const fullMessage = `🚨 *NOTIFICACIÓN FANTASÍAS* 🚨\n\n${message}`;

      for (const employee of employees) {
        try {
          const phone = employee.phone;
          const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
          
          await whatsappService.sendMessage(branchId, formattedPhone, fullMessage);
          logger.info(`📢 Alerta enviada a empleado ${phone} (${employee.name}) desde sucursal ${branchId}`);
        } catch (error) {
          logger.error(`❌ Error enviando alerta a ${employee.phone}:`, error);
        }
      }
    } catch (dbError) {
      logger.error('❌ Error consultando empleados para notificaciones:', dbError);
    }
  }
}

module.exports = new NotificationService();

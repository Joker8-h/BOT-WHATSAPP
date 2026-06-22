const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class EmployeeController {
  async list(req, res) {
    try {
      const { branchId } = req.query;
      const filter = {};
      if (branchId) filter.branchId = parseInt(branchId);

      const employees = await prisma.employeeAccess.findMany({
        where: filter,
        orderBy: [{ branchId: 'asc' }, { createdAt: 'desc' }],
        include: { branch: { select: { name: true, city: true } } },
      });

      res.json({ success: true, data: employees });
    } catch (error) {
      logger.error('Error listando empleados:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  async create(req, res) {
    try {
      const { phone, name, role, description, branchId } = req.body;

      if (!phone || !branchId) {
        return res.status(400).json({ success: false, error: 'Teléfono y sucursal son requeridos' });
      }

      const cleanPhone = String(phone).replace(/[^0-9]/g, '');

      const employee = await prisma.employeeAccess.upsert({
        where: { phone_branchId: { phone: cleanPhone, branchId: parseInt(branchId) } },
        update: { name, role, description },
        create: { phone: cleanPhone, name, role, description, branchId: parseInt(branchId) },
      });

      res.json({ success: true, data: employee });
    } catch (error) {
      logger.error('Error creando empleado:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, phone, role, description, branchId } = req.body;

      const data = {};
      if (name !== undefined) data.name = name;
      if (phone !== undefined) data.phone = String(phone).replace(/[^0-9]/g, '');
      if (role !== undefined) data.role = role;
      if (description !== undefined) data.description = description;
      if (branchId !== undefined) data.branchId = parseInt(branchId);

      const employee = await prisma.employeeAccess.update({
        where: { id: parseInt(id) },
        data,
      });

      res.json({ success: true, data: employee });
    } catch (error) {
      logger.error('Error actualizando empleado:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }

  async remove(req, res) {
    try {
      const { id } = req.params;
      await prisma.employeeAccess.delete({ where: { id: parseInt(id) } });
      res.json({ success: true, message: 'Empleado eliminado' });
    } catch (error) {
      logger.error('Error eliminando empleado:', error);
      res.status(500).json({ success: false, error: 'Error del servidor' });
    }
  }
}

module.exports = new EmployeeController();

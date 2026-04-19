// ─────────────────────────────────────────────────────────
//  ROUTES: Gestión de Acceso de Empleados
// ─────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { checkBranchAccess } = require('../middleware/auth');

/**
 * Listar empleados autorizados de la sucursal actual
 */
router.get('/', checkBranchAccess, async (req, res) => {
  try {
    const branchId = req.user.branchId || parseInt(req.query.branchId);
    
    if (!branchId) {
      return res.status(400).json({ success: false, error: 'Sucursal no identificada' });
    }

    const employees = await prisma.employeeAccess.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: employees });
  } catch (error) {
    logger.error('Error listando empleados:', error);
    res.status(500).json({ success: false, error: 'Error del servidor' });
  }
});

/**
 * Añadir nuevo empleado autorizado
 */
router.post('/', checkBranchAccess, async (req, res) => {
  try {
    const { phone, name, branchId: reqBranchId } = req.body;
    const branchId = req.user.branchId || parseInt(reqBranchId);

    if (!phone || !branchId) {
      return res.status(400).json({ success: false, error: 'Teléfono y sucursal son requeridos' });
    }

    const cleanPhone = String(phone).replace(/[^0-9]/g, '');

    const employee = await prisma.employeeAccess.upsert({
      where: {
        phone_branchId: {
          phone: cleanPhone,
          branchId
        }
      },
      update: { name },
      create: {
        phone: cleanPhone,
        name,
        branchId
      }
    });

    res.json({ success: true, data: employee });
  } catch (error) {
    logger.error('Error añadiendo empleado:', error);
    res.status(500).json({ success: false, error: 'Error del servidor' });
  }
});

/**
 * Eliminar acceso de un empleado
 */
router.delete('/:id', checkBranchAccess, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.employeeAccess.delete({
      where: { id: parseInt(id) }
    });

    res.json({ success: true, message: 'Acceso eliminado' });
  } catch (error) {
    logger.error('Error eliminando empleado:', error);
    res.status(500).json({ success: false, error: 'Error del servidor' });
  }
});

module.exports = router;

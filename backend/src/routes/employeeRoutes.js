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
    // MANAGER solo su sede; ADMIN debe explicitarla (o usa la propia si la tiene)
    const branchId = req.user.role !== 'ADMIN'
      ? req.user.branchId
      : (parseInt(req.query.branchId) || req.user.branchId);
    
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
    // MANAGER solo su sede (el body no puede inyectar otra)
    const branchId = req.user.role !== 'ADMIN'
      ? req.user.branchId
      : (parseInt(reqBranchId) || req.user.branchId);

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

    // Ownership: verificar que el acceso pertenece a una sede visible antes de borrar
    const where = { id: parseInt(id) };
    if (req.user.role !== 'ADMIN') where.branchId = req.user.branchId;
    const existing = await prisma.employeeAccess.findFirst({ where });
    if (!existing) return res.status(404).json({ success: false, error: 'Acceso no encontrado' });

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

const { prisma } = require('../config/database');
const catalogService = require('../services/catalogService');
const logger = require('../utils/logger');

const getProducts = async (req, res) => {
  try {
    const { branchId, category, search, page = '1', limit = '20', isAvailable } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (branchId || req.apiKey.branchId) {
      where.branchId = parseInt(branchId || req.apiKey.branchId);
    }
    if (category) where.category = category;
    if (isAvailable !== undefined) where.isAvailable = isAvailable === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { name: 'asc' },
        include: { branch: { select: { id: true, name: true, city: true } } }
      }),
      prisma.product.count({ where })
    ]);

    res.json({
      success: true,
      data: products.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: Number(p.price),
        category: p.category,
        stock: p.stock,
        isAvailable: p.isAvailable,
        imageUrl: p.imageUrl,
        branch: p.branch ? { id: p.branch.id, name: p.branch.name, city: p.branch.city } : null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.error('Error en GET /v1/products:', error);
    res.status(500).json({ success: false, error: 'Error al consultar productos' });
  }
};

const getProduct = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });

    const where = { id };
    if (req.apiKey.branchId) where.branchId = req.apiKey.branchId;

    const product = await prisma.product.findFirst({
      where,
      include: { branch: { select: { id: true, name: true, city: true } } }
    });

    if (!product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado' });
    }

    res.json({
      success: true,
      data: {
        id: product.id,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        category: product.category,
        emotionalDesc: product.emotionalDesc,
        stock: product.stock,
        isAvailable: product.isAvailable,
        isFeatured: product.isFeatured,
        imageUrl: product.imageUrl,
        branch: product.branch ? { id: product.branch.id, name: product.branch.name, city: product.branch.city } : null,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      }
    });
  } catch (error) {
    logger.error('Error en GET /v1/products/:id:', error);
    res.status(500).json({ success: false, error: 'Error al consultar producto' });
  }
};

const updateStock = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });

    const { operation, quantity } = req.body;

    if (!operation || !['set', 'deduct', 'add'].includes(operation)) {
      return res.status(400).json({ success: false, error: 'operation debe ser "set", "deduct" o "add"' });
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 0) {
      return res.status(400).json({ success: false, error: 'quantity debe ser un número entero >= 0' });
    }

    const where = { id };
    if (req.apiKey.branchId) where.branchId = req.apiKey.branchId;

    const product = await prisma.product.findFirst({ where });
    if (!product) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado' });
    }

    let newStock;

    if (operation === 'set') {
      newStock = qty;
    } else if (operation === 'deduct') {
      if (product.stock < qty) {
        return res.status(400).json({
          success: false,
          error: `Stock insuficiente. Disponible: ${product.stock}, solicitado: ${qty}`
        });
      }
      newStock = product.stock - qty;
    } else if (operation === 'add') {
      newStock = product.stock + qty;
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        stock: newStock,
        isAvailable: newStock > 0
      }
    });

    catalogService.invalidateCache();

    res.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        previousStock: product.stock,
        currentStock: updated.stock,
        operation
      }
    });
  } catch (error) {
    logger.error('Error en PATCH /v1/products/:id/stock:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar stock' });
  }
};

const getInventorySummary = async (req, res) => {
  try {
    const where = {};
    if (req.apiKey.branchId) where.branchId = req.apiKey.branchId;

    const [total, available, lowStock, critical, outOfStock, totalValue] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, isAvailable: true } }),
      prisma.product.count({ where: { ...where, stock: { lte: 5, gt: 0 } } }),
      prisma.product.count({ where: { ...where, stock: { lte: 3, gt: 0 } } }),
      prisma.product.count({ where: { ...where, stock: 0 } }),
      prisma.product.aggregate({
        where: { ...where, isAvailable: true },
        _sum: { price: true }
      })
    ]);

    const lowStockProducts = await prisma.product.findMany({
      where: { ...where, stock: { lte: 5 } },
      select: { id: true, name: true, stock: true, category: true },
      orderBy: { stock: 'asc' },
      take: 20
    });

    res.json({
      success: true,
      data: {
        counts: { total, available, lowStock, critical, outOfStock },
        totalInventoryValue: totalValue._sum.price ? Number(totalValue._sum.price) : 0,
        alerts: lowStockProducts.map(p => ({
          id: p.id,
          name: p.name,
          stock: p.stock,
          level: p.stock === 0 ? 'AGOTADO' : p.stock <= 3 ? 'CRITICO' : 'BAJO'
        }))
      }
    });
  } catch (error) {
    logger.error('Error en GET /v1/inventory:', error);
    res.status(500).json({ success: false, error: 'Error al consultar inventario' });
  }
};

const getBranches = async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true, isAuthorized: true },
      select: { id: true, name: true, city: true, address: true }
    });

    res.json({ success: true, data: branches });
  } catch (error) {
    logger.error('Error en GET /v1/branches:', error);
    res.status(500).json({ success: false, error: 'Error al consultar sucursales' });
  }
};

module.exports = { getProducts, getProduct, updateStock, getInventorySummary, getBranches };

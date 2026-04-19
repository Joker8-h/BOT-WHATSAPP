// ─────────────────────────────────────────────────────────
//  SERVICE: Catálogo de Productos (Multi-sucursal)
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class CatalogService {
  constructor() {
    // Cache por sucursal: branchId -> { data, time }
    this._caches = new Map();
    this._cacheTTL = 5 * 60 * 1000; // 5 minutos
  }

  /**
   * Obtiene todos los productos disponibles de una sucursal
   */
  async getAllProducts(branchId) {
    if (!branchId) return [];

    const cached = this._caches.get(branchId);
    if (cached && (Date.now() - cached.time) < this._cacheTTL) {
      return cached.data;
    }

    const products = await prisma.product.findMany({
      where: { isAvailable: true, branchId },
      orderBy: [{ isFeatured: 'desc' }, { category: 'asc' }],
    });

    this._caches.set(branchId, { data: products, time: Date.now() });
    return products;
  }

  /**
   * Obtiene productos por categorías para una sucursal específica (para la IA)
   * Si no hay productos en esas categorías, busca cualquier otro de la misma sucursal (fallback)
   */
  async getProductsByCategories(categories, limit = 3, branchId) {
    if (!branchId) {
      logger.warn('⚠️ getProductsByCategories llamado sin branchId. Retornando vacío para evitar fuga de datos.');
      return [];
    }

    const where = {
        isAvailable: true,
        branchId: branchId, // Obligatorio
        category: { in: categories },
    };

    let products = await prisma.product.findMany({
      where,
      orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
      take: limit * categories.length,
    });

    // FALLBACK: Si no hay nada en esas categorías para ESTA sucursal, traemos lo más destacado que sí haya
    if (products.length === 0) {
      logger.info(`ℹ️ Fallback: No hay stock de ${categories.join(',')} en sucursal ${branchId}. Trayendo destacados generales.`);
      products = await prisma.product.findMany({
        where: { isAvailable: true, branchId: branchId },
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        take: limit * 2,
      });
    }

    return products;
  }

  /**
   * Busca un producto por nombre en una sucursal
   */
  async findProductByName(name, branchId) {
    const product = await prisma.product.findFirst({
      where: {
        isAvailable: true,
        branchId,
        name: { contains: name },
      },
    });

    return product;
  }

  /**
   * Crea o actualiza un producto dentro de una sucursal
   */
  async upsertProduct(productData) {
    const { branchId, excelRef, name } = productData;

    // Buscamos si existe por referencia de excel O nombre dentro de la misma sucursal
    const existing = await prisma.product.findFirst({
      where: {
        branchId,
        OR: [
          excelRef ? { excelRef } : null,
          { name }
        ].filter(Boolean)
      }
    });

    if (existing) {
      return prisma.product.update({
        where: { id: existing.id },
        data: productData,
      });
    }

    return prisma.product.create({ data: productData });
  }

  /**
   * Invalida la caché de una sucursal
   */
  invalidateCache(branchId) {
    if (branchId) {
      this._caches.delete(branchId);
    } else {
      this._caches.clear();
    }
  }
}

module.exports = new CatalogService();

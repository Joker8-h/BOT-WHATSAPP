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
  async getProductsByCategories(categories, limit = 8, branchId) {
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
   * Normaliza un texto para comparar nombres de productos:
   * minúsculas, sin tildes, sin puntuación ni espacios sobrantes.
   */
  _normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // quitar tildes
      .replace(/[*_`"']/g, '')
      .replace(/[^a-z0-9#\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extrae la cantidad del nombre que escribe la IA.
   * Soporta: "Producto x2", "Producto (x2)", "2x Producto", "2 Producto".
   */
  _parseQuantity(rawName) {
    let name = String(rawName || '').trim().replace(/[*_]/g, '').trim();
    let quantity = 1;

    const patterns = [
      /^(.+?)\s*\(?\s*[x×]\s*(\d{1,2})\s*\)?$/i,   // "Producto x2" / "Producto (x2)"
      /^\s*(\d{1,2})\s*[x×]\s*(.+)$/i,             // "2x Producto"
    ];

    let match = name.match(patterns[0]);
    if (match) {
      name = match[1].trim();
      quantity = parseInt(match[2], 10);
    } else {
      match = name.match(patterns[1]);
      if (match) {
        quantity = parseInt(match[1], 10);
        name = match[2].trim();
      }
    }

    // Cantidad razonable: evita interpretar códigos de modelo como cantidades
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) quantity = 1;

    return { name: name.replace(/[.,;:]+$/, '').trim(), quantity };
  }

  /**
   * Puntúa qué tan bien coincide el nombre buscado con el nombre del producto.
   * Devuelve 0..1 (0 = no coincide).
   */
  _scoreMatch(searchNorm, productNorm) {
    if (!searchNorm || !productNorm) return 0;
    if (searchNorm === productNorm) return 1;
    if (productNorm.includes(searchNorm) || searchNorm.includes(productNorm)) return 0.9;

    const searchTokens = searchNorm.split(' ').filter(t => t.length >= 3);
    if (searchTokens.length === 0) return 0;

    const productTokens = new Set(productNorm.split(' ').filter(Boolean));
    let hits = 0;
    for (const token of searchTokens) {
      if (productTokens.has(token)) { hits += 1; continue; }
      // Coincidencia parcial (plurales, abreviaciones: "lubricantes" ↔ "lubricante")
      if ([...productTokens].some(pt => pt.startsWith(token) || token.startsWith(pt))) hits += 0.75;
    }

    return hits / searchTokens.length;
  }

  /**
   * Busca un producto por nombre en una sucursal.
   * Estrategia en cascada para NUNCA perder un producto del pedido:
   *   1. Coincidencia directa en BD (contains)
   *   2. Coincidencia normalizada (sin tildes/puntuación) sobre el catálogo
   *   3. Coincidencia por tokens (nombre parcial o reordenado)
   * Devuelve el producto con `parsedQuantity` y `matchScore`.
   */
  async findProductByName(rawName, branchId) {
    const { name: productName, quantity } = this._parseQuantity(rawName);
    if (!productName) return null;

    // 1. Coincidencia directa en BD
    let product = await prisma.product.findFirst({
      where: { isAvailable: true, branchId, name: { contains: productName } },
    });
    if (product) return { ...product, parsedQuantity: quantity, matchScore: 1 };

    // 2 y 3. Comparación normalizada contra el catálogo de la sucursal
    const catalog = await this.getAllProducts(branchId);
    if (!catalog.length) return null;

    const searchNorm = this._normalize(productName);
    let best = null;
    let bestScore = 0;

    for (const candidate of catalog) {
      const score = this._scoreMatch(searchNorm, this._normalize(candidate.name));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    // Umbral: al menos 60% de las palabras buscadas deben coincidir
    if (best && bestScore >= 0.6) {
      logger.info(`🔎 [CATALOG] "${productName}" → "${best.name}" (coincidencia ${Math.round(bestScore * 100)}%)`);
      return { ...best, parsedQuantity: quantity, matchScore: bestScore };
    }

    // Último recurso: buscar entre productos NO disponibles para poder avisar
    // al dueño de que el cliente pidió algo agotado en vez de ignorarlo.
    const unavailable = await prisma.product.findFirst({
      where: { branchId, isAvailable: false, name: { contains: productName } },
    });
    if (unavailable) {
      logger.warn(`⚠️ [CATALOG] "${productName}" existe pero está AGOTADO en sucursal ${branchId}`);
      return { ...unavailable, parsedQuantity: quantity, matchScore: 0.9, isOutOfStock: true };
    }

    logger.warn(`❌ [CATALOG] Producto no identificado en sucursal ${branchId}: "${productName}"`);
    return null;
  }

  /**
   * Resuelve una lista de nombres de productos de un pedido.
   * Devuelve los items encontrados Y los no encontrados, para que ningún
   * producto pedido por el cliente desaparezca en silencio.
   */
  async resolveOrderProducts(names = [], branchId) {
    const items = [];
    const productNames = [];
    const notFound = [];
    const outOfStock = [];
    let totalAmount = 0;

    for (const rawName of names) {
      if (!rawName || !String(rawName).trim()) continue;

      const product = await this.findProductByName(rawName, branchId);

      if (!product) {
        notFound.push(String(rawName).trim());
        continue;
      }

      const qty = product.parsedQuantity || 1;

      // Evitar duplicados: si el mismo producto ya está, se suma la cantidad
      const existing = items.find(i => i.productId === product.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        items.push({ productId: product.id, quantity: qty, price: product.price });
      }

      totalAmount += parseFloat(product.price) * qty;
      productNames.push(`${product.name}${qty > 1 ? ` x${qty}` : ''}`);
      if (product.isOutOfStock) outOfStock.push(product.name);
    }

    return { items, productNames, notFound, outOfStock, totalAmount };
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

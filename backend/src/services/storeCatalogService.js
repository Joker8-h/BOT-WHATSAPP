// ─────────────────────────────────────────────────────────
//  SERVICE: Catálogo de la tienda web (fuente principal de productos)
//  Sincroniza la API de productos de la página con la tabla Product
//  del bot. Los productos traídos de aquí quedan marcados con
//  excelRef = "API-<id>" y tienen prioridad sobre el Excel/Drive.
// ─────────────────────────────────────────────────────────
const axios = require('axios');
const { prisma } = require('../config/database');
const catalogService = require('./catalogService');
const { classifyProduct } = require('../ai/salesKnowledge');
const logger = require('../utils/logger');

const DEFAULT_API_URL = 'https://backend-production-daf05.up.railway.app/api/products';
const API_REF_PREFIX = 'API-';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

// Tipo de producto (salesKnowledge) → categoría del bot. Lo que no encaje queda en CONEXION_PAREJA.
const CATEGORY_BY_TYPE = {
  EXPERIENCIAS_INTENSAS: ['vibrador', 'succionador', 'dildo', 'masturbador', 'plug', 'funda', 'bondage', 'lubricante_anal', 'ducha_anal'],
  EXPLORACION_SUAVE: ['lenceria', 'venda'],
  SORPRESAS_DISCRETAS: ['bala', 'anillo', 'juguete'],
};

class StoreCatalogService {
  constructor() {
    this._running = false;
    this.lastResult = null;
  }

  get config() {
    const flag = String(process.env.STORE_PRODUCTS_API || 'on').toLowerCase();
    const enabled = !['off', 'false', '0', 'no'].includes(flag);
    const url = String(process.env.STORE_PRODUCTS_API_URL || DEFAULT_API_URL).split('?')[0].trim();
    const branchIds = String(process.env.STORE_PRODUCTS_BRANCH_IDS || '1')
      .split(',').map(n => parseInt(n.trim(), 10)).filter(Number.isFinite);
    return { enabled, url, branchIds };
  }

  isApiProduct(product) {
    return String(product?.excelRef || '').startsWith(API_REF_PREFIX);
  }

  async fetchAll(url = this.config.url) {
    const all = [];
    let page = 1;
    let totalPages = 1;
    do {
      const { data } = await axios.get(url, { params: { limit: PAGE_SIZE, page }, timeout: 20000 });
      const list = Array.isArray(data?.products) ? data.products : (Array.isArray(data) ? data : []);
      all.push(...list);
      totalPages = Number(data?.totalPages) || 1;
      page += 1;
    } while (page <= totalPages && page <= MAX_PAGES);

    const unique = new Map();
    for (const p of all) {
      if (p?.id && String(p.name || '').trim()) unique.set(String(p.id), p);
    }
    return [...unique.values()];
  }

  _firstImage(images) {
    if (!Array.isArray(images)) return null;
    for (const img of images) {
      const url = typeof img === 'string' ? img : (img?.secure_url || img?.url || img?.src);
      if (url && /^https?:\/\//i.test(url)) return String(url).slice(0, 500);
    }
    return null;
  }

  _category(name, description) {
    const types = classifyProduct({ name, description });
    if (types.some(t => CATEGORY_BY_TYPE.EXPERIENCIAS_INTENSAS.includes(t))) return 'EXPERIENCIAS_INTENSAS';
    if (types.some(t => CATEGORY_BY_TYPE.EXPLORACION_SUAVE.includes(t))) return 'EXPLORACION_SUAVE';
    if (types.some(t => CATEGORY_BY_TYPE.SORPRESAS_DISCRETAS.includes(t))) return 'SORPRESAS_DISCRETAS';
    return 'CONEXION_PAREJA';
  }

  _emotionalDesc(item) {
    const parts = [];
    if (item.category?.name) {
      parts.push(item.category.description ? `${item.category.name}: ${item.category.description}` : item.category.name);
    }
    const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
    if (tags.length) parts.push(`Ideal para: ${tags.join(', ')}`);
    return parts.join('. ').slice(0, 1000) || null;
  }

  toProductData(item, branchId, existing = null) {
    const name = String(item.name).replace(/\s+/g, ' ').trim().slice(0, 190);
    const description = String(item.description || '').trim();
    const price = Number(item.price) || 0;
    const stock = Math.max(0, parseInt(item.stock, 10) || 0);
    const imageUrl = this._firstImage(item.images) || existing?.imageUrl || null;

    return {
      name,
      description,
      emotionalDesc: this._emotionalDesc(item),
      price,
      stock,
      category: this._category(name, description),
      isAvailable: item.isActive !== false && price > 0 && stock > 0,
      imageUrl,
      branchId,
      excelRef: `${API_REF_PREFIX}${item.id}`.slice(0, 50),
    };
  }

  /**
   * Sincroniza la API con todas las sedes configuradas.
   * Si la API falla o viene vacía no se modifica nada (evita dejar al bot sin catálogo).
   */
  async sync() {
    const { enabled, url, branchIds } = this.config;
    if (!enabled || !url || !branchIds.length) return null;
    if (this._running) return null;
    this._running = true;

    try {
      logger.info(`🛍️ [STORE-API] Descargando catálogo de la tienda: ${url}`);
      const items = await this.fetchAll(url);
      if (!items.length) {
        logger.warn('⚠️ [STORE-API] La API no devolvió productos. Se conserva el catálogo actual.');
        return null;
      }

      const results = [];
      for (const branchId of branchIds) {
        results.push(await this._syncBranch(branchId, items));
      }
      catalogService.invalidateCache();
      this.lastResult = { at: new Date().toISOString(), total: items.length, results };
      return this.lastResult;
    } catch (error) {
      logger.error(`❌ [STORE-API] Error sincronizando catálogo de la tienda: ${error.response?.status || ''} ${error.message}`);
      return null;
    } finally {
      this._running = false;
    }
  }

  async _syncBranch(branchId, items) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
    if (!branch) {
      logger.warn(`⚠️ [STORE-API] La sede ${branchId} no existe. Se omite.`);
      return { branchId, skipped: true };
    }

    const current = await prisma.product.findMany({
      where: { branchId, excelRef: { startsWith: API_REF_PREFIX } },
      select: { id: true, excelRef: true, imageUrl: true },
    });
    const byRef = new Map(current.map(p => [p.excelRef, p]));

    const syncedIds = [];
    let created = 0;
    let updated = 0;
    let adopted = 0;

    for (const item of items) {
      try {
        const ref = `${API_REF_PREFIX}${item.id}`.slice(0, 50);
        let existing = byRef.get(ref) || null;

        // Si el producto ya existía (p. ej. cargado desde Excel), se adopta en vez de duplicarlo.
        if (!existing) {
          const sameName = await prisma.product.findFirst({
            where: { branchId, name: String(item.name).replace(/\s+/g, ' ').trim().slice(0, 190) },
            select: { id: true, excelRef: true, imageUrl: true },
          });
          if (sameName && !this.isApiProduct(sameName)) {
            existing = sameName;
            adopted += 1;
          }
        }

        const data = this.toProductData(item, branchId, existing);
        const saved = existing
          ? await prisma.product.update({ where: { id: existing.id }, data })
          : await prisma.product.create({ data });
        if (existing) updated += 1; else created += 1;
        syncedIds.push(saved.id);
      } catch (error) {
        logger.warn(`⚠️ [STORE-API] No se pudo guardar "${item?.name}": ${error.message}`);
      }
    }

    const deactivated = await prisma.product.updateMany({
      where: {
        branchId,
        excelRef: { startsWith: API_REF_PREFIX },
        id: { notIn: syncedIds.length ? syncedIds : [0] },
        isAvailable: true,
      },
      data: { isAvailable: false },
    });

    logger.info(`✨ [STORE-API] Sede ${branch.name}: ${created} nuevos, ${updated} actualizados (${adopted} adoptados del Excel), ${deactivated.count} retirados.`);
    return { branchId, created, updated, adopted, deactivated: deactivated.count };
  }
}

module.exports = new StoreCatalogService();

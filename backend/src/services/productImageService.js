// ─────────────────────────────────────────────────────────
//  SERVICE: Motor visual de productos
//  Decide qué fotos enviar al cliente SIN depender de que la IA
//  escriba la etiqueta [IMAGEN:url]:
//    1. Fotos que la IA pidió con [IMAGEN:url]
//    2. Productos del catálogo que Sofía nombró en su respuesta
//    3. Si el cliente pidió fotos y no hay nada aún: los productos
//       que le interesaron (ficha de venta) o que él mismo nombró
//  Cada foto sale con caption (nombre + precio) y no se repite la
//  misma foto en la conversación salvo que el cliente la pida.
// ─────────────────────────────────────────────────────────
const catalogService = require('./catalogService');
const logger = require('../utils/logger');

const PHOTO_REQUEST_RE = /\b(fotos?|fotico|fotic[oa]s|imagen|imagenes|imágenes|video|videos|muestr\w*|mostrar\w*|ensen\w*|enseñ\w*|ver\s*(lo|la|los|las)|verl[oa]s?|como\s+es|cómo\s+es|como\s+son|cómo\s+son|como\s+se\s+ve|cómo\s+se\s+ve|como\s+luce|cómo\s+luce)\b/i;

const MAX_IMAGES_PER_TURN = 2;
const MAX_REMEMBERED = 40;

function money(value) {
  return `$${Number(value || 0).toLocaleString('es-CO')}`;
}

/**
 * Convierte enlaces de Google Drive / Dropbox en enlaces directos de imagen.
 */
function normalizeImageUrl(rawUrl) {
  if (!rawUrl) return null;
  let url = String(rawUrl).trim().replace(/^Media:\s*/i, '');
  if (!/^https?:\/\//i.test(url)) return null;

  const driveFile = url.match(/drive\.google\.com\/file\/d\/([\w-]{10,})/i);
  const driveOpen = url.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]{10,})/i);
  const driveId = driveFile?.[1] || driveOpen?.[1];
  if (driveId) return `https://drive.google.com/uc?export=download&id=${driveId}`;

  if (/dropbox\.com\//i.test(url)) {
    url = url.replace(/[?&]dl=0/, '').replace(/\?$/, '');
    return `${url}${url.includes('?') ? '&' : '?'}raw=1`;
  }
  return url;
}

class ProductImageService {
  wantsPhotos(text) {
    return PHOTO_REQUEST_RE.test(String(text || ''));
  }

  caption(product) {
    if (!product) return '';
    const stock = product.stock > 0 ? '' : '\n⚠️ Agotado por ahora';
    return `✨ *${product.name}*\n💰 ${money(product.price)} COP${stock}`;
  }

  /**
   * Productos del catálogo nombrados en un texto, en orden de aparición.
   * Usa los segmentos en *negrita* (como Sofía escribe los nombres) y
   * coincidencias del nombre completo.
   */
  findMentionedProducts(text, catalog = []) {
    if (!text || !catalog.length) return [];
    const norm = catalogService._normalize(text);
    const found = new Map(); // id -> { product, pos }

    // a) Nombre completo del producto dentro del texto
    for (const p of catalog) {
      const pn = catalogService._normalize(p.name);
      if (pn.length < 6) continue;
      const pos = norm.indexOf(pn);
      if (pos >= 0) found.set(p.id, { product: p, pos });
    }

    // b) Segmentos en negrita: "*Vibrador Rabbit*"
    const boldRe = /\*([^*\n]{4,90})\*/g;
    let m;
    while ((m = boldRe.exec(text)) !== null) {
      const segment = catalogService._normalize(m[1]);
      if (segment.length < 4) continue;
      let best = null;
      let bestScore = 0;
      for (const p of catalog) {
        const score = catalogService._scoreMatch(segment, catalogService._normalize(p.name));
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (best && bestScore >= 0.75 && catalogService._isReliableSaleMatch(m[1], { ...best, matchScore: bestScore })) {
        const pos = norm.indexOf(segment);
        const prev = found.get(best.id);
        if (!prev || (pos >= 0 && pos < prev.pos)) found.set(best.id, { product: best, pos: pos >= 0 ? pos : m.index });
      }
    }

    return [...found.values()].sort((a, b) => a.pos - b.pos).map(f => f.product);
  }

  /**
   * @returns {Promise<Array<{url:string, caption:string, productId:number|null, source:string}>>}
   */
  async pickImages({ actions = {}, aiText = '', userText = '', sale = {}, branchId, alreadySent = [], limit = MAX_IMAGES_PER_TURN }) {
    let catalog = [];
    try {
      catalog = await catalogService.getAllProducts(branchId);
    } catch (err) {
      logger.warn(`⚠️ [IMG-ENGINE] No se pudo leer el catálogo: ${err.message}`);
    }

    const userAsked = this.wantsPhotos(userText);
    const closing = !!(actions.shouldCreateContraEntrega || actions.shouldCloseSale);
    const sentSet = new Set((alreadySent || []).map(u => normalizeImageUrl(u)).filter(Boolean));
    const queue = [];
    const queuedUrls = new Set();

    const push = (url, product, source) => {
      const clean = normalizeImageUrl(url);
      if (!clean || queuedUrls.has(clean) || queue.length >= limit) return;
      if (!userAsked && sentSet.has(clean)) return; // no repetir la misma foto
      queuedUrls.add(clean);
      queue.push({ url: clean, caption: this.caption(product), productId: product?.id || null, source });
    };

    // 1. Lo que la IA pidió explícitamente
    for (const tagUrl of actions.images || []) {
      const clean = normalizeImageUrl(tagUrl);
      if (!clean) continue;
      const product = catalog.find(p => normalizeImageUrl(p.imageUrl) === clean) || null;
      push(clean, product, 'tag');
    }

    // 2. Productos que Sofía nombró (solo si no está cerrando el pedido)
    if (queue.length < limit && (!closing || userAsked)) {
      for (const p of this.findMentionedProducts(aiText, catalog)) {
        if (p.imageUrl) push(p.imageUrl, p, 'mentioned');
      }
    }

    // 3. El cliente pidió fotos y aún no hay nada: lo que nombró él o le interesó
    if (queue.length === 0 && userAsked) {
      const candidates = [
        ...this.findMentionedProducts(userText, catalog),
        ...[...(sale?.interestProducts || [])].reverse()
          .map(n => {
            const nn = catalogService._normalize(n);
            return catalog.find(p => catalogService._normalize(p.name) === nn)
              || catalog.find(p => catalogService._scoreMatch(nn, catalogService._normalize(p.name)) >= 0.9);
          })
          .filter(Boolean),
      ];
      for (const p of candidates) {
        if (p.imageUrl) push(p.imageUrl, p, 'requested');
      }
    }

    if (queue.length) {
      logger.info(`🖼️ [IMG-ENGINE] ${queue.length} foto(s) para enviar: ${queue.map(q => `${q.source}#${q.productId || '?'}`).join(', ')}`);
    }
    return queue;
  }

  /** Recuerda las fotos ya enviadas en el contexto de la conversación. */
  rememberSent(ctx, urls = []) {
    const prev = Array.isArray(ctx?.sentImages) ? ctx.sentImages : [];
    const merged = [...prev.filter(u => !urls.includes(u)), ...urls].slice(-MAX_REMEMBERED);
    return { ...(ctx || {}), sentImages: merged };
  }
}

module.exports = new ProductImageService();
module.exports.normalizeImageUrl = normalizeImageUrl;
module.exports.PHOTO_REQUEST_RE = PHOTO_REQUEST_RE;

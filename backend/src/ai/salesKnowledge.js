// ─────────────────────────────────────────────────────────
//  AI: Conocimiento comercial de Fantasías
//  Tipos de producto, combos automáticos y mapa de recompra
//  (basado en el Manual Profesional del Bot — módulos 9 y 19)
// ─────────────────────────────────────────────────────────

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const phraseRegexCache = new Map();

/**
 * ¿El texto (ya normalizado) contiene la frase como palabra(s) completa(s)?
 * Acepta plurales simples: "vibrador" coincide con "vibradores".
 */
function containsPhrase(normalizedText, phrase) {
  if (!normalizedText || !phrase) return false;
  let re = phraseRegexCache.get(phrase);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizeText(phrase))}(es|s)?($|[^a-z0-9])`);
    phraseRegexCache.set(phrase, re);
  }
  return re.test(normalizedText);
}

// ── Tipos de producto ────────────────────────────────────
const PRODUCT_TYPES = {
  vibrador:        { label: 'Vibradores', toy: true, keywords: ['vibrador', 'vibradora', 'punto g', 'conejo', 'rabbit', 'vibrador punto g', 'estimulador punto g'] },
  succionador:     { label: 'Succionadores / estimuladores de clítoris', toy: true, keywords: ['succionador', 'succion', 'satisfyer', 'clitoriano', 'clitorial', 'estimulador de clitoris', 'estimulador clitoris', 'clitoris'] },
  dildo:           { label: 'Dildos / consoladores', toy: true, keywords: ['dildo', 'consolador', 'realistico', 'realista', 'pene realistico'] },
  bala:            { label: 'Balas y huevos vibradores', toy: true, keywords: ['bala', 'bala vibradora', 'huevo vibrador', 'huevito vibrador', 'mini vibrador'] },
  masturbador:     { label: 'Masturbadores masculinos', toy: true, keywords: ['masturbador', 'vagina artificial', 'huevo masturbador', 'fleshlight'] },
  anillo:          { label: 'Anillos', toy: true, keywords: ['anillo', 'anillo vibrador', 'anillo retardante'] },
  plug:            { label: 'Juguetes anales', toy: true, keywords: ['plug', 'plug anal', 'juguete anal', 'bolas anales', 'bolitas anales', 'dilatador'] },
  juguete:         { label: 'Juguetes', toy: true, generic: true, keywords: ['juguete', 'juguetico', 'juguete sexual'] },
  lubricante_anal: { label: 'Lubricantes anales', keywords: ['lubricante anal', 'gel anal', 'anal gel', 'easy anal', 'crema anal', 'spray anal', 'anal relax', 'relajante anal', 'desensibilizante anal'] },
  lubricante:      { label: 'Lubricantes', keywords: ['lubricante', 'lubricante intimo', 'gel intimo', 'gel lubricante', 'lubricante sabor', 'lubricante caliente', 'lubricante frio'] },
  retardante:      { label: 'Retardantes', keywords: ['retardante', 'retardador', 'eyaculacion precoz', 'precoz', 'durar mas', 'aguantar mas', 'dure mas', 'sativa'] },
  potencializador: { label: 'Potencializadores', keywords: ['potencializador', 'potenciador', 'ereccion', 'viagra', 'vigorizante', 'energizante sexual', 'estimulante masculino'] },
  excitante:       { label: 'Excitantes / multiorgásmicos', keywords: ['multiorgasmico', 'multiorgasmica', 'excitante', 'estimulante femenino', 'acelerador', 'vibrador liquido', 'orgasmico', 'hormigueo'] },
  feromona:        { label: 'Feromonas', keywords: ['feromona', 'perfume feromona', 'locion feromona', 'atrayente'] },
  lenceria:        { label: 'Lencería', keywords: ['lenceria', 'baby doll', 'babydoll', 'body', 'tanga', 'corset', 'corse', 'liguero', 'liga', 'encaje', 'medias de malla', 'disfraz', 'bata', 'conjunto de lenceria', 'conjunto sexy', 'panty'] },
  aceite_masaje:   { label: 'Aceites y velas de masaje', keywords: ['aceite', 'aceite de masaje', 'aceite caliente', 'masaje', 'vela de masaje', 'vela'] },
  bondage:         { label: 'Bondage / línea fetish', keywords: ['esposas', 'bondage', 'amarres', 'cuerdas', 'mordaza', 'fusta', 'latigo', 'fetish', 'fetiche', 'bdsm', 'collar', 'inmovilizador'] },
  venda:           { label: 'Vendas y antifaces', keywords: ['venda', 'tapaojos', 'tapa ojos', 'antifaz'] },
  limpiador:       { label: 'Limpiadores de juguetes', keywords: ['limpiador', 'limpiador de juguetes', 'shampoo', 'toy cleaner'] },
  bolsa:           { label: 'Bolsas y estuches', keywords: ['bolsa', 'bolsita', 'estuche', 'bolsa de tela'] },
  ducha_anal:      { label: 'Duchas anales', keywords: ['ducha anal', 'ducha', 'enema', 'lavado anal', 'pera anal'] },
  preservativo:    { label: 'Preservativos', keywords: ['preservativo', 'condon', 'condones'] },
  juego:           { label: 'Juegos eróticos', keywords: ['juego erotico', 'juegos eroticos', 'dados', 'cartas eroticas', 'ruleta', 'kamasutra'] },
};

const TOY_TYPES = Object.entries(PRODUCT_TYPES).filter(([, t]) => t.toy && !t.generic).map(([k]) => k);

// ── Combos automáticos (tipo → complementos, en orden de prioridad) ──
const TOY_COMBO = ['lubricante', 'limpiador', 'bolsa'];
const COMBO_MAP = {
  vibrador: TOY_COMBO, succionador: TOY_COMBO, dildo: TOY_COMBO, bala: TOY_COMBO,
  masturbador: TOY_COMBO, anillo: ['lubricante', 'preservativo', 'retardante'], juguete: TOY_COMBO,
  plug: ['lubricante_anal', 'ducha_anal', 'limpiador'],
  lubricante_anal: ['ducha_anal', 'preservativo'],
  lubricante: ['preservativo', 'aceite_masaje', 'feromona'],
  retardante: ['potencializador', 'feromona'],
  potencializador: ['retardante', 'feromona'],
  excitante: ['lubricante', 'aceite_masaje'],
  feromona: ['aceite_masaje', 'lenceria'],
  lenceria: ['feromona', 'aceite_masaje', 'bondage'],
  aceite_masaje: ['venda', 'feromona'],
  bondage: ['venda', 'lubricante', 'aceite_masaje'],
  venda: ['aceite_masaje', 'bondage'],
  juego: ['aceite_masaje', 'venda'],
  preservativo: ['lubricante'],
};

// ── Recompra según lo que compró (módulo 19) ──
const TOY_REPURCHASE = ['lubricante', 'limpiador', 'bolsa', 'vibrador', 'succionador'];
const REPURCHASE_MAP = {
  vibrador: TOY_REPURCHASE, succionador: TOY_REPURCHASE, dildo: TOY_REPURCHASE, bala: TOY_REPURCHASE,
  masturbador: ['lubricante', 'limpiador', 'retardante'], plug: ['lubricante_anal', 'ducha_anal', 'limpiador'],
  anillo: ['lubricante', 'retardante', 'potencializador'],
  lubricante: ['vibrador', 'preservativo', 'aceite_masaje', 'feromona'],
  lubricante_anal: ['plug', 'ducha_anal', 'preservativo'],
  retardante: ['potencializador', 'feromona', 'lubricante'],
  potencializador: ['retardante', 'feromona', 'preservativo'],
  excitante: ['vibrador', 'lubricante', 'feromona'],
  lenceria: ['aceite_masaje', 'feromona', 'venda', 'bala'],
  feromona: ['lenceria', 'aceite_masaje', 'excitante'],
  aceite_masaje: ['venda', 'feromona', 'excitante'],
  bondage: ['venda', 'aceite_masaje', 'lubricante'],
};
const DEFAULT_REPURCHASE = ['feromona', 'aceite_masaje', 'lubricante'];

/**
 * Detecta los tipos de producto mencionados en un texto libre (mensaje del cliente).
 * "juguete" genérico se expande a todos los tipos de juguete.
 */
function detectProductTypes(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  const found = [];
  for (const [type, def] of Object.entries(PRODUCT_TYPES)) {
    if (def.keywords.some(k => containsPhrase(norm, k))) found.push(type);
  }
  // "lubricante anal" no debe contar además como lubricante genérico
  if (found.includes('lubricante_anal')) {
    const idx = found.indexOf('lubricante');
    if (idx >= 0) found.splice(idx, 1);
  }
  return found;
}

function expandTypes(types) {
  const out = new Set();
  for (const t of types) {
    if (PRODUCT_TYPES[t]?.generic) TOY_TYPES.forEach(tt => out.add(tt));
    else out.add(t);
  }
  return [...out];
}

const productTypeCache = new Map();

/**
 * Clasifica un producto del catálogo en uno o varios tipos (por nombre, y si no
 * hay coincidencia, por descripción).
 */
function classifyProduct(product) {
  if (!product) return [];
  const cacheKey = `${product.id}:${product.updatedAt ? new Date(product.updatedAt).getTime() : ''}:${product.name}`;
  if (productTypeCache.has(cacheKey)) return productTypeCache.get(cacheKey);

  let types = detectProductTypes(product.name).filter(t => !PRODUCT_TYPES[t].generic);
  if (types.length === 0) {
    types = detectProductTypes(String(product.description || '').substring(0, 200)).filter(t => !PRODUCT_TYPES[t].generic);
  }
  if (types.length === 0 && detectProductTypes(product.name).includes('juguete')) types = ['vibrador'];

  productTypeCache.set(cacheKey, types);
  return types;
}

function isToy(product) {
  return classifyProduct(product).some(t => PRODUCT_TYPES[t]?.toy);
}

function getComplementTypes(types) {
  const out = [];
  for (const t of types) {
    for (const c of COMBO_MAP[t] || []) {
      if (!types.includes(c) && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

function getRepurchaseTypes(types) {
  const out = [];
  for (const t of types) {
    for (const c of REPURCHASE_MAP[t] || []) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out.length ? out : DEFAULT_REPURCHASE;
}

function priceOf(p) {
  return Number(p?.price || 0);
}

/**
 * Elige el mejor producto del catálogo para un tipo dado, respetando un precio
 * máximo (los complementos no deben superar al producto principal).
 */
function pickProductOfType(type, catalog, { maxPrice = Infinity, excludeIds = new Set() } = {}) {
  const candidates = catalog.filter(p =>
    !excludeIds.has(p.id) &&
    p.stock > 0 &&
    priceOf(p) > 0 &&
    priceOf(p) <= maxPrice &&
    classifyProduct(p).includes(type)
  );
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    // Preferir el complemento de precio medio: ni el más barato ni rozando el principal
    const target = maxPrice === Infinity ? 0 : maxPrice * 0.5;
    return Math.abs(priceOf(a) - target) - Math.abs(priceOf(b) - target);
  });
  return candidates[0];
}

/**
 * Complementos sugeridos para un producto principal según el mapa de combos.
 */
function pickComplements(mainProduct, catalog, max = 3) {
  const types = classifyProduct(mainProduct);
  const complementTypes = getComplementTypes(types);
  const excludeIds = new Set([mainProduct.id]);
  const result = [];

  for (const type of complementTypes) {
    if (result.length >= max) break;
    const pick = pickProductOfType(type, catalog, { maxPrice: priceOf(mainProduct), excludeIds });
    if (pick) {
      result.push({ type, product: pick });
      excludeIds.add(pick.id);
    }
  }
  return result;
}

function formatCOPShort(value) {
  return `$${Number(value || 0).toLocaleString('es-CO')}`;
}

function formatComplementsSection(mainProducts, catalog) {
  const lines = [];
  for (const main of mainProducts) {
    const comps = pickComplements(main, catalog);
    if (!comps.length) continue;
    const compStr = comps
      .map(c => `${c.product.name} (${formatCOPShort(c.product.price)})${c.product.imageUrl ? ` [IMAGEN:${c.product.imageUrl}]` : ''}`)
      .join(' + ');
    lines.push(`- Si lleva *${main.name}* (${formatCOPShort(main.price)}) → ofrécele: ${compStr}`);
  }
  if (!lines.length) return '';
  return `## COMPLEMENTOS SUGERIDOS (combo automático, ya filtrados para no superar el precio del principal)\n${lines.join('\n')}\nOfrece 1 o 2 de estos (no todos a la vez), como mejora de la experiencia.`;
}

/**
 * Índice compacto de TODO el catálogo (tipo → nombre + precio) para que Sofía
 * sepa lo que existe aunque no esté entre los productos detallados.
 */
function buildCatalogIndex(catalog, maxLines = 260) {
  if (!catalog?.length) return '';
  const groups = new Map();
  for (const p of catalog) {
    if (p.stock <= 0) continue;
    const types = classifyProduct(p);
    const key = types[0] ? PRODUCT_TYPES[types[0]].label : 'Otros';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const perGroup = Math.max(8, Math.floor(maxLines / Math.max(groups.size, 1)));
  let out = '## ÍNDICE DEL CATÁLOGO (todo lo disponible hoy: nombre y precio; si recomiendas algo de aquí, usa el nombre exacto)';
  let lines = 0;
  for (const [label, items] of groups) {
    items.sort((a, b) => priceOf(a) - priceOf(b));
    const shown = items.slice(0, perGroup);
    out += `\n### ${label} (${items.length})\n` + shown.map(p => `- ${p.name} ${formatCOPShort(p.price)}`).join('\n');
    if (items.length > shown.length) out += `\n- ...y ${items.length - shown.length} más`;
    lines += shown.length;
    if (lines >= maxLines) break;
  }
  return out;
}

module.exports = {
  normalizeText,
  containsPhrase,
  PRODUCT_TYPES,
  TOY_TYPES,
  COMBO_MAP,
  REPURCHASE_MAP,
  detectProductTypes,
  expandTypes,
  classifyProduct,
  isToy,
  getComplementTypes,
  getRepurchaseTypes,
  pickProductOfType,
  pickComplements,
  formatComplementsSection,
  buildCatalogIndex,
};

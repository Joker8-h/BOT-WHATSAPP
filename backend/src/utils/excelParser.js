// ─────────────────────────────────────────────────────────
//  UTILS: Excel Parser — Importa productos desde Excel
// ─────────────────────────────────────────────────────────
const XLSX = require('xlsx');
const path = require('path');
const logger = require('./logger');

/**
 * Lee un archivo Excel y retorna un array de objetos
 * @param {string} filePath — Ruta al archivo .xlsx
 * @param {string} sheetName — Nombre de la hoja (opcional, usa la primera)
 * @returns {array} Array de objetos con los datos
 */
function parseExcel(filePath, sheetName = null) {
  try {
    const absolutePath = path.resolve(filePath);
    const workbook = XLSX.readFile(absolutePath);

    const sheet = sheetName
      ? workbook.Sheets[sheetName]
      : workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) {
      throw new Error(`Hoja "${sheetName || 'primera'}" no encontrada`);
    }

    const data = XLSX.utils.sheet_to_json(sheet, {
      defval: '', // Valor por defecto para celdas vacías
      raw: false, // Convertir todo a strings
    });

    logger.info(`📊 Excel parseado: ${data.length} filas de "${absolutePath}"`);
    return data;
  } catch (error) {
    logger.error('Error parseando Excel:', error);
    throw error;
  }
}

/**
 * Mapea datos del Excel al formato de producto de la BD
 * Adaptable según las columnas del Excel del usuario
 */
function mapExcelToProducts(excelData) {
  return excelData.map((row, index) => {
    // Intentar detectar columnas comunes
    const name = row.Nombre || row.nombre || row.NOMBRE || row.Producto || row.producto || row.Name || `Producto ${index + 1}`;
    const description = row.Descripcion || row.descripcion || row.DESCRIPCION || row.Description || '';
    const rawPrice = row.Precio || row.precio || row.PRECIO || row.Price || row.Valor || row.valor || '0';
    const price = parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 0;
    const category = mapCategory(row.Categoria || row.categoria || row.CATEGORIA || row.Category || '');
    const stock = parseInt(row.Stock || row.stock || row.STOCK || row.Cantidad || row.cantidad || '0') || 0;
    const ref = row.Ref || row.ref || row.REF || row.Codigo || row.codigo || row.SKU || row.sku || `EX-${index + 1}`;
    const imageUrl = row.Imagen || row.imagen || row.ImageUrl || row.URL || '';
    const branchId = row.Sucursal || row.sucursal || row.BranchId || row.branchId || null;

    return {
      name: String(name).trim(),
      description: String(description).trim(),
      price,
      category,
      emotionalDesc: generateEmotionalDescription(name, category),
      isFeatured: false,
      stock,
      isAvailable: price > 0,
      imageUrl: String(imageUrl).trim() || null,
      excelRef: String(ref).trim(),
      branchId: branchId ? parseInt(branchId) : null
    };
  }).filter(p => p.name && p.price > 0);
}

/**
 * Mapea la categoría del Excel a las categorías emocionales
 */
function mapCategory(rawCategory) {
  const cat = String(rawCategory).toLowerCase().trim();

  if (cat.includes('pareja') || cat.includes('conexion') || cat.includes('romanc') || cat.includes('suave')) {
    return 'CONEXION_PAREJA';
  }
  if (cat.includes('explora') || cat.includes('intermedi') || cat.includes('nuevo')) {
    return 'EXPLORACION_SUAVE';
  }
  if (cat.includes('sorpresa') || cat.includes('regalo') || cat.includes('discret')) {
    return 'SORPRESAS_DISCRETAS';
  }
  if (cat.includes('intens') || cat.includes('avanzad') || cat.includes('premium') || cat.includes('especial')) {
    return 'EXPERIENCIAS_INTENSAS';
  }

  // Default
  return 'CONEXION_PAREJA';
}

/**
 * Genera una descripción emocional para el producto
 */
function generateEmotionalDescription(name, category) {
  const templates = {
    CONEXION_PAREJA: `Perfecto para esos momentos de reconexión y complicidad con tu pareja. ${name} está diseñado para crear experiencias memorables juntos.`,
    EXPLORACION_SUAVE: `Dale un toque diferente a su intimidad. ${name} es ideal para quienes buscan explorar algo nuevo con discreción y elegancia.`,
    SORPRESAS_DISCRETAS: `Una sorpresa que habla por sí sola. ${name} es el regalo perfecto para sorprender a esa persona especial.`,
    EXPERIENCIAS_INTENSAS: `Para quienes buscan llevar la experiencia al siguiente nivel. ${name} es sinónimo de intensidad y conexión profunda.`,
  };

  return templates[category] || templates.CONEXION_PAREJA;
}

module.exports = { parseExcel, mapExcelToProducts, mapCategory };

// ─────────────────────────────────────────────────────────
//  UTILS: Excel Parser — Importa productos desde Excel
// ─────────────────────────────────────────────────────────
const ExcelJS = require('exceljs');
const path = require('path');
const logger = require('./logger');
const cloudinary = require('../config/cloudinary');

/**
 * Sube un buffer de imagen a Cloudinary
 * @param {Buffer} buffer 
 * @returns {Promise<string>} URL segura de la imagen
 */
function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'fantasias_products' },
      (error, result) => {
        if (error) {
          logger.error('Error subiendo imagen a Cloudinary desde Excel:', error);
          resolve(null); // Fallback suave
        } else {
          resolve(result.secure_url);
        }
      }
    );
    stream.end(buffer);
  });
}

/**
 * Lee un archivo Excel, extrae imágenes incrustadas, y retorna un array de objetos
 * @param {string} filePath — Ruta al archivo .xlsx
 * @returns {Promise<array>} Array de objetos con los datos y URLs de imágenes
 */
async function parseExcel(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(absolutePath);

    const sheet = workbook.worksheets[0]; // Usar la primera hoja
    if (!sheet) {
      throw new Error(`Hoja no encontrada`);
    }

    // 1. Obtener todas las filas (evitando fila 1 si es encabezado)
    const rowsData = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Saltar encabezados

      const values = row.values;
      // ExcelJS row.values[1] es la columna A, [2] es B, etc.
      rowsData.push({
        rowNumber,
        name: values[2] ? String(values[2]).trim() : '', // Columna B: NOMBRE
        features: values[3] ? String(values[3]).trim() : '', // Columna C: CARACTERISTICAS
        stock: parseInt(values[4]) || 0, // Columna D: CANTIDAD
        price: parseFloat(String(values[5] || '0').replace(/[^0-9.]/g, '')) || 0, // Columna E: PRECIO
        imageUrl: null // Se llenará en el paso 2 si hay imagen
      });
    });

    // 2. Extraer imágenes y subirlas a Cloudinary
    logger.info(`🔍 Buscando imágenes incrustadas en el Excel...`);
    const images = sheet.getImages();
    
    for (const image of images) {
      // image.range.tl.nativeRow es el índice base 0 de la fila donde está la esquina sup izq. de la imagen
      const imgRowNumber = image.range.tl.nativeRow + 1; 
      // image.range.tl.nativeCol es la columna (0 = A, 1 = B)
      const imgColNumber = image.range.tl.nativeCol;

      // Buscamos si la imagen está en la columna A (0)
      if (imgColNumber === 0) {
        const media = workbook.model.media.find(m => m.index === image.imageId);
        if (media && media.buffer) {
          // Encontrar a qué producto pertenece esta fila
          const targetRow = rowsData.find(r => r.rowNumber === imgRowNumber);
          if (targetRow) {
            logger.info(`☁️ Subiendo imagen de la fila ${imgRowNumber}...`);
            const url = await uploadBufferToCloudinary(media.buffer);
            if (url) {
              targetRow.imageUrl = url;
            }
          }
        }
      }
    }

    logger.info(`📊 Excel parseado: ${rowsData.length} filas procesadas de "${absolutePath}"`);
    return rowsData;
  } catch (error) {
    logger.error('Error parseando Excel asíncrono:', error);
    throw error;
  }
}

/**
 * Mapea datos del Excel al formato de producto de la BD
 */
function mapExcelToProducts(excelData) {
  return excelData.map((row, index) => {
    const category = mapCategory(''); // Por defecto

    return {
      name: row.name || `Producto ${index + 1}`,
      description: row.features, // Usamos CARACTERISTICAS como description
      price: row.price,
      category,
      emotionalDesc: generateEmotionalDescription(row.name || `Producto ${index + 1}`, category),
      isFeatured: false,
      stock: row.stock,
      isAvailable: row.price > 0,
      imageUrl: row.imageUrl,
      excelRef: `EX-${row.rowNumber}`,
      branchId: null
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

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

    // 1. Detectar mapeo de columnas dinámicamente
    let colMapping = {
      name: 2,      // Default Col B
      features: 3,  // Default Col C
      quantity: 4,  // Default Col D (Formato 2)
      price: 5,     // Default Col E
      image: 1,     // Default Col A
      category: null // Opcional
    };

    // Intentar encontrar la fila de encabezados para ajustar el mapeo
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 10) return; // Solo revisar las primeras filas
      const values = row.values;
      if (!values) return;

      values.forEach((val, index) => {
        const text = String(val || '').toUpperCase();
        if (text.includes('CANTIDAD')) { colMapping.quantity = index; }
        if (text.includes('NOMBRE')) { colMapping.name = index; }
        if (text.includes('CARACTERISTICAS') || text.includes('PRODCUTO')) { colMapping.features = index; }
        if (text.includes('PRECIO')) { colMapping.price = index; }
        if (text.includes('JUGUETE') || text.includes('IMAGEN')) { colMapping.image = index; }
        if (text.includes('CATEGORIA')) { colMapping.category = index; }
      });
    });

    // 2. Obtener todas las filas
    const rowsData = [];
    sheet.eachRow((row, rowNumber) => {
      const values = row.values;
      if (!values || values.length < 3) return;

      const name = values[colMapping.name] ? String(values[colMapping.name]).trim() : '';
      
      // Saltar encabezados y filas vacías
      if (!name || name.length < 3 || name === 'NOMBRE' || name === 'PRODUCTO') return;
      if (name.toUpperCase() === name && name.length > 30) return; // Secciones

      // Extraer datos usando el mapeo detectado
      const rawPrice = values[colMapping.price];
      const priceStr = String(rawPrice || '0').replace(/[^0-9]/g, '');
      const price = parseFloat(priceStr) || 0;

      const rawStock = values[colMapping.quantity];
      const stock = parseInt(String(rawStock || '0').replace(/[^0-9]/g, '')) || 0;

      const category = colMapping.category ? values[colMapping.category] : '';

      // Intentar detectar si el valor de la celda es una URL (IMAGE() de Google Sheets)
      let imageUrl = null;
      const imgCellVal = values[colMapping.image];
      if (imgCellVal && typeof imgCellVal === 'string' && (imgCellVal.startsWith('http') || imgCellVal.includes('cloudinary'))) {
        imageUrl = imgCellVal;
      }

      rowsData.push({
        rowNumber,
        name: name,
        features: values[colMapping.features] ? String(values[colMapping.features]).trim() : '', 
        stock: stock,
        price: price,
        category: category,
        imageUrl: imageUrl 
      });
    });

    // 3. Extraer imágenes incrustadas (Flotantes)
    const images = sheet.getImages();
    logger.info(`🔍 Se encontraron ${images.length} imágenes flotantes en el Excel.`);
    
    for (const image of images) {
      const imgRowNumber = image.range.tl.nativeRow + 1; 
      const imgColNumber = image.range.tl.nativeCol;

      // Buscamos si la imagen está en la columna configurada O en cualquier columna (fallback)
      const media = workbook.model.media.find(m => m.index === image.imageId);
      if (media && media.buffer) {
        const targetRow = rowsData.find(r => r.rowNumber === imgRowNumber);
        if (targetRow && !targetRow.imageUrl) { // No sobreescribir si ya detectamos URL
          logger.info(`☁️ Subiendo imagen flotante de fila ${imgRowNumber}...`);
          const url = await uploadBufferToCloudinary(media.buffer);
          if (url) targetRow.imageUrl = url;
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
 * Mapea la categoría del Excel a las categorías emocionales basándose en palabras clave
 */
function mapCategory(rawCategory, name = '', features = '') {
  const fullText = `${rawCategory} ${name} ${features}`.toLowerCase();

  // 1. CONEXION_PAREJA (Masajes, Lubricantes, Juegos, Velas)
  if (
    fullText.includes('lubricante') || fullText.includes('aceite') || fullText.includes('masaje') || 
    fullText.includes('vela') || fullText.includes('juego') || fullText.includes('pareja') ||
    fullText.includes('crema') || fullText.includes('gel') || fullText.includes('comestible')
  ) {
    return 'CONEXION_PAREJA';
  }

  // 2. EXPLORACION_SUAVE (Lencería, Disfraces, Accesorios básicos)
  if (
    fullText.includes('lenceria') || fullText.includes('body') || fullText.includes('baby') || 
    fullText.includes('disfraz') || fullText.includes('pantalon') || fullText.includes('media') ||
    fullText.includes('tanga') || fullText.includes('accesorio') || fullText.includes('cosmetico')
  ) {
    return 'EXPLORACION_SUAVE';
  }

  // 3. SORPRESAS_DISCRETAS (Pequeños juguetes, Vibradores bala, Anillos)
  if (
    fullText.includes('bala') || fullText.includes('anillo') || fullText.includes('huevo') || 
    fullText.includes('discreto') || fullText.includes('sorpresa') || fullText.includes('regalo') ||
    fullText.includes('mini') || fullText.includes('bullet')
  ) {
    return 'SORPRESAS_DISCRETAS';
  }

  // 4. EXPERIENCIAS_INTENSAS (Vibradores grandes, Succionadores, Bondage, Anal)
  if (
    fullText.includes('vibrador') || fullText.includes('succion') || fullText.includes('anal') || 
    fullText.includes('dildo') || fullText.includes('arnes') || fullText.includes('bondage') ||
    fullText.includes('esposa') || fullText.includes('latigo') || fullText.includes('premium') ||
    fullText.includes('prostatico') || fullText.includes('rabbit') || fullText.includes('satisfyer')
  ) {
    return 'EXPERIENCIAS_INTENSAS';
  }

  // Default si no detecta nada claro
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

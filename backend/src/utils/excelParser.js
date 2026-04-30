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

    // 1. Detectar mapeo de columnas dinámicamente (Detección Agresiva)
    let colMapping = {
      name: 2,      
      features: 3,  
      quantity: 4,  
      price: 5,     
      image: 1,     
      category: null 
    };

    // Intentar encontrar la fila de encabezados con búsqueda difusa
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 10) return; 
      row.eachCell((cell, colNumber) => {
        const text = String(cell.value || '').toUpperCase().trim();
        // Usamos includes para ignorar filtros, espacios o caracteres raros
        if (text.includes('CANT') || text.includes('STOCK')) { colMapping.quantity = colNumber; }
        if (text.includes('NOMBR') || text.includes('PROD')) { colMapping.name = colNumber; }
        if (text.includes('CARACT') || text.includes('DESCRI') || text.includes('DETALLE')) { colMapping.features = colNumber; }
        if (text.includes('PRECIO') || text.includes('VALOR') || text.includes('COSTO')) { colMapping.price = colNumber; }
        if (text.includes('JUGUETE') || text.includes('IMAGEN') || text.includes('FOTO')) { colMapping.image = colNumber; }
        if (text.includes('CATEG')) { colMapping.category = colNumber; }
      });
    });

    logger.info(`🔍 [MAPEO] Columnas detectadas: ${JSON.stringify(colMapping)}`);

    // 2. Obtener todas las filas
    const rowsData = [];
    sheet.eachRow((row, rowNumber) => {
      const values = row.values;
      if (!values || rowNumber < 2) return; 

      const getCleanText = (val) => {
        if (!val) return '';
        if (typeof val === 'object') {
          if (val.richText) return val.richText.map(t => t.text).join(' ');
          return val.result || val.text || '';
        }
        return String(val).trim();
      };

      let name = getCleanText(values[colMapping.name]);
      
      // Saltar encabezados y secciones vacías
      if (!name || name.length < 3 || name.toUpperCase() === 'NOMBRE' || name.toUpperCase() === 'PRODUCTO') return;
      if (name.toUpperCase() === name && name.length > 50) return; 

      // Extraer Precio
      const rawPrice = values[colMapping.price];
      const priceStr = getCleanText(rawPrice).replace(/[^0-9]/g, '');
      const price = parseFloat(priceStr) || 0;

      // Extraer Stock
      const rawStock = values[colMapping.quantity];
      const stockStr = getCleanText(rawStock).replace(/[^0-9]/g, '');
      const stock = parseInt(stockStr) || 0;

      const features = getCleanText(values[colMapping.features]);
      const category = colMapping.category ? getCleanText(values[colMapping.category]) : '';

      rowsData.push({
        rowNumber,
        name,
        features, 
        stock,
        price,
        category,
        imageUrl: null 
      });
    });

    // 3. Extraer imágenes incrustadas (Lógica de Precisión Espacial)
    const images = sheet.getImages();
    logger.info(`🔍 [IMG] Procesando ${images.length} imágenes encontradas en el libro.`);
    
    for (const image of images) {
      try {
        const media = workbook.model.media.find(m => m.index === image.imageId);
        if (!media || !media.buffer) continue;

        // Calculamos la fila "centro" de la imagen para mayor precisión
        // nativeRow es 0-indexed, sumamos 1 para comparar con rowNumber
        const startRow = image.range.tl.nativeRow + 1;
        const endRow = image.range.br ? image.range.br.nativeRow + 1 : startRow;
        const centerRow = (startRow + endRow) / 2;

        // También verificamos la columna (Col A es 0)
        const imgCol = image.range.tl.nativeCol + 1;

        // Buscamos la fila de datos que esté más cerca del centro de esta imagen
        // Solo buscamos en filas que estén en un rango razonable (+/- 1.5 filas)
        let bestMatch = null;
        let minDistance = 1.5;

        for (const row of rowsData) {
          const distance = Math.abs(row.rowNumber - centerRow);
          if (distance < minDistance) {
            // Verificamos que la imagen esté en la columna de imágenes (o cerca)
            const colDistance = Math.abs(imgCol - colMapping.image);
            if (colDistance <= 1) { // Tolerancia de 1 columna
              minDistance = distance;
              bestMatch = row;
            }
          }
        }

        if (bestMatch && !bestMatch.imageUrl) {
          logger.info(`☁️ [UPLOAD] Subiendo imagen para "${bestMatch.name}" (Fila Excel: ${Math.round(centerRow)})...`);
          
          const url = await new Promise((resolve) => {
            const stream = cloudinary.uploader.upload_stream(
              { 
                folder: 'fantasias_products',
                use_filename: true,
                unique_filename: true,
                quality: 'auto:best',
                resource_type: 'image'
              },
              (error, result) => {
                if (error) {
                  logger.error('❌ Error Cloudinary:', error);
                  resolve(null);
                } else {
                  resolve(result.secure_url);
                }
              }
            );
            stream.end(media.buffer);
          });

          if (url) {
            bestMatch.imageUrl = url;
            logger.info(`✅ [OK] Imagen vinculada a "${bestMatch.name}"`);
          }
        }
      } catch (err) {
        logger.error('❌ Error procesando imagen individual:', err);
      }
    }

    logger.info(`📊 Excel parseado: ${rowsData.length} filas procesadas de "${absolutePath}"`);
    return { rows: rowsData, colMapping };
  } catch (error) {
    logger.error('Error parseando Excel asíncrono:', error);
    throw error;
  }
}

/**
 * Mapea datos del Excel al formato de producto de la BD
 */
function mapExcelToProducts(excelData) {
  if (!Array.isArray(excelData)) {
    logger.error('❌ Error: mapExcelToProducts recibió datos que no son una lista:', excelData);
    return [];
  }
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

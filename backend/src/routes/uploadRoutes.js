// ─────────────────────────────────────────────────────────
//  ROUTES: Carga de Archivos a Cloudinary
// ─────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const { checkBranchAccess } = require('../middleware/auth');
const logger = require('../utils/logger');

// Configuración de Multer: Almacenamiento temporal en memoria
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Límite de 5MB
});

/**
 * Carga una imagen a Cloudinary
 */
router.post('/image', upload.single('image'), async (req, res) => {
  console.log('--- NUEVA PETICIÓN DE SUBIDA RECIBIDA ---');
  try {
    if (!req.file) {
      logger.warn('⚠️ Intento de subida sin archivo');
      return res.status(400).json({ success: false, error: 'No se envió ninguna imagen' });
    }

    logger.debug(`📤 Iniciando subida a Cloudinary: ${req.file.originalname} (${req.file.size} bytes)`);

    // Subir buffer a Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'fantasias/products' },
        (error, result) => {
          if (error) {
            logger.error('❌ Cloudinary SDK Error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
      stream.end(req.file.buffer);
    });

    logger.info('✅ Imagen subida con éxito:', uploadResult.secure_url);

    res.json({
      success: true,
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id
    });
  } catch (error) {
    logger.error('❌ Error crítico en upload/image:', error.message || error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al procesar la imagen', 
      details: error.message || 'Error desconocido' 
    });
  }
});

module.exports = router;

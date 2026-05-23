// ─────────────────────────────────────────────────────────
//  CONFIG: Cloudinary — Almacenamiento de imágenes
//  El SDK detecta CLOUDINARY_URL del .env automáticamente.
//  Formato: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
// ─────────────────────────────────────────────────────────
const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

// Forzar HTTPS en todas las URLs generadas
cloudinary.config({ secure: true });

logger.info(`☁️ Cloudinary configurado — cloud: ${cloudinary.config().cloud_name}`);

module.exports = cloudinary;

// ─────────────────────────────────────────────────────────
//  CONFIG: Cloudinary — Almacenamiento de imágenes
//  Acepta CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET,
//  o en su defecto CLOUDINARY_URL (cloudinary://API_KEY:API_SECRET@CLOUD_NAME).
//  CLOUDINARY_FOLDER define la carpeta donde se suben las fotos de productos.
// ─────────────────────────────────────────────────────────
const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME.trim(),
    api_key: CLOUDINARY_API_KEY.trim(),
    api_secret: CLOUDINARY_API_SECRET.trim(),
    secure: true,
  });
} else {
  cloudinary.config({ secure: true });
}

const PRODUCTS_FOLDER = (process.env.CLOUDINARY_FOLDER || 'fantasias/products').trim().replace(/^\/+|\/+$/g, '');

if (cloudinary.config().cloud_name) {
  logger.info(`☁️ Cloudinary configurado — cloud: ${cloudinary.config().cloud_name}, carpeta: ${PRODUCTS_FOLDER}`);
} else {
  logger.warn('⚠️ Cloudinary sin configurar: define CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET (o CLOUDINARY_URL).');
}

module.exports = cloudinary;
module.exports.PRODUCTS_FOLDER = PRODUCTS_FOLDER;

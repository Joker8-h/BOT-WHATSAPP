const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');

class GoogleSheetsService {
  constructor() {
    this.auth = null;
    this.keyFile = path.join(__dirname, '../config/google-service-account.json');
    this.scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  }

  /**
   * Inicializa la autenticación con Google
   */
  _initAuth() {
    if (this.auth) return this.auth;

    try {
      // Intentar primero con variable de entorno (para producción/seguridad)
      if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        this.auth = new google.auth.GoogleAuth({
          credentials,
          scopes: this.scopes,
        });
        return this.auth;
      }

      // Si no hay env var, buscar el archivo físico (si existe)
      if (fs.existsSync(this.keyFile)) {
        this.auth = new google.auth.GoogleAuth({
          keyFile: this.keyFile,
          scopes: this.scopes,
        });
        return this.auth;
      }

      logger.warn('⚠️ Google Service Account NOT CONFIGURED (No env var nor key file). Two-way sync disabled.');
      return null;
    } catch (error) {
      logger.error('❌ Error initializing Google Auth:', error);
      return null;
    }
  }

  /**
   * Actualiza el stock de un producto directamente en Google Sheets
   * @param {number} productId - ID del producto en la DB
   * @param {number} newStock - Nuevo valor de stock
   */
  async updateStock(productId, newStock) {
    try {
      // 1. Obtener datos del producto y su fuente
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { branch: true }
      });

      if (!product || !product.excelRef || !product.excelRef.startsWith('DRIVE-')) {
        return; // No es un producto sincronizado de Drive
      }

      const parts = product.excelRef.split('-');
      const sourceId = parseInt(parts[1]);
      const rowNumber = parseInt(parts[2]);

      const source = await prisma.syncSource.findUnique({
        where: { id: sourceId }
      });

      if (!source || !source.config) return;

      const colMapping = source.config;
      const quantityCol = colMapping.stock; // Ejemplo: 'E'

      if (!quantityCol) {
        logger.warn(`⚠️ No se encontró mapeo de columna de stock para fuente ${sourceId}`);
        return;
      }

      // 2. Extraer Spreadsheet ID de la URL
      const spreadsheetId = this._extractFileId(source.url);
      if (!spreadsheetId) return;

      // 3. Autenticar y Escribir
      const auth = this._initAuth();
      if (!auth) return;

      const sheets = google.sheets({ version: 'v4', auth });

      // Google Sheets usa notación A1 (ej: 'Hoja1!E10')
      // Asumimos la primera hoja si no hay nombre configurado
      const range = `${quantityCol}${rowNumber}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[newStock]]
        }
      });

      logger.info(`✅ Stock actualizado en Google Sheets: Fila ${rowNumber}, Col ${quantityCol} -> ${newStock}`);

    } catch (error) {
      logger.error('❌ Error updating Google Sheet stock:', error);
    }
  }

  /**
   * Extrae el ID del archivo de una URL de Google Drive
   */
  _extractFileId(url) {
    const match = url.match(/[-\w]{25,}/);
    return match ? match[0] : null;
  }
}

module.exports = new GoogleSheetsService();

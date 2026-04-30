const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');
const { parseExcel, mapCategory } = require('../utils/excelParser');
const catalogService = require('./catalogService');
const logger = require('../utils/logger');

class SyncService {
  /**
   * Convierte un link de Google Drive en un link de descarga directa
   */
  getDirectDownloadUrl(url) {
    if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
      const match = url.match(/\/d\/(.+?)(?:\/|edit|#|$)/);
      if (match && match[1]) {
        return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
      }
    }
    return url;
  }

  /**
   * Ejecuta la sincronización para todas las fuentes activas
   */
  async syncAll() {
    logger.info('🔄 Iniciando sincronización global de inventario...');
    
    try {
      const sources = await prisma.syncSource.findMany({
        where: { isActive: true },
        include: { branch: true }
      });

      for (const source of sources) {
        await this.syncSource(source);
      }

      logger.info('✅ Sincronización global completada.');
    } catch (error) {
      logger.error('❌ Error en syncAll:', error);
    }
  }

  /**
   * Sincroniza una fuente específica
   */
  async syncSource(source) {
    const tempPath = path.join(__dirname, `../../temp_sync_${source.id}.xlsx`);
    
    try {
      logger.info(`📡 Sincronizando fuente: ${source.name} (Sede: ${source.branch.name})...`);
      
      const downloadUrl = this.getDirectDownloadUrl(source.url);
      const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 2. Parsear el Excel y obtener mapeo
      const { rows: rawData, colMapping } = await parseExcel(tempPath);
      
      // Guardar mapeo en la fuente para futuras actualizaciones (Bot -> Excel)
      await prisma.syncSource.update({
        where: { id: source.id },
        data: { config: colMapping }
      });

      // 3. Procesar y Guardar en DB
      let updatedCount = 0;
      let createdCount = 0;
      const syncedProductIds = [];

      if (!Array.isArray(rawData)) {
        throw new Error(`Los datos del Excel no son válidos (no iterable) para la fuente ${source.name}`);
      }

      for (const row of rawData) {
        // VALIDACIÓN: ¿Falta información?
        const isComplete = row.name && row.features && row.price > 0 && row.stock >= 0;
        
        // DETECCIÓN AUTOMÁTICA DE CATEGORÍA
        const category = mapCategory(row.category || '', row.name, row.features); 

        // Verificar si el producto ya existe y ya tiene imagen
        const existing = await prisma.product.findFirst({
          where: { 
            name: row.name || 'Producto Sin Nombre',
            branchId: source.branchId
          }
        });

        // Si el producto ya tiene imagen en la BD, usar esa en vez de re-subir
        const productData = {
          name: row.name || 'Producto Sin Nombre',
          description: row.features || '',
          price: row.price,
          category: category,
          stock: row.stock,
          isAvailable: isComplete, 
          branchId: source.branchId,
          excelRef: `DRIVE-${source.id}-${row.rowNumber}`
        };

        if (existing && existing.imageUrl) {
          // Ya tiene imagen, no re-subir
          productData.imageUrl = existing.imageUrl;
        } else if (row.imageUrl) {
          // Imagen nueva del Excel
          productData.imageUrl = row.imageUrl;
        }

        let savedProduct;
        if (existing) {
          savedProduct = await prisma.product.update({
            where: { id: existing.id },
            data: productData
          });
          updatedCount++;
        } else {
          savedProduct = await prisma.product.create({
            data: productData
          });
          createdCount++;
        }
        syncedProductIds.push(savedProduct.id);
      }

      // 4. LIMPIEZA: Desactivar productos que ya no están en el Excel
      const deactivated = await prisma.product.updateMany({
        where: {
          branchId: source.branchId,
          excelRef: { startsWith: `DRIVE-${source.id}-` },
          id: { notIn: syncedProductIds }
        },
        data: { isAvailable: false }
      });

      // 5. Actualizar estado de la fuente con resumen
      const summary = `SUCCESS: ${createdCount} nuevos, ${updatedCount} actualizados, ${deactivated.count} desactivados.`.substring(0, 255);
      await prisma.syncSource.update({
        where: { id: source.id },
        data: {
          lastSyncAt: new Date(),
          lastStatus: summary
        }
      });

      logger.info(`✨ Sincronización exitosa [${source.name}]: ${createdCount} creados, ${updatedCount} actualizados.`);
      
      catalogService.invalidateCache();

    } catch (error) {
      logger.error(`❌ Error sincronizando fuente ${source.name}:`, error);
      await prisma.syncSource.update({
        where: { id: source.id },
        data: { lastStatus: 'ERROR' }
      }).catch(() => {});
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
}

module.exports = new SyncService();

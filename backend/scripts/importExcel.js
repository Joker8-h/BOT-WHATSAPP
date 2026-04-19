// ─────────────────────────────────────────────────────────
//  SCRIPT: Importar productos desde Excel
//  Uso: npm run import:products
// ─────────────────────────────────────────────────────────
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { prisma, connectDatabase } = require('../src/config/database');
const { parseExcel, mapExcelToProducts } = require('../src/utils/excelParser');
const catalogService = require('../src/services/catalogService');

async function importProducts() {
  console.log('📦 Importando productos desde Excel...\n');

  // Buscar archivo Excel en la carpeta data/
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const excelFiles = fs.readdirSync(dataDir).filter(f =>
    f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')
  );

  if (excelFiles.length === 0) {
    console.error('❌ No se encontró ningún archivo Excel en la carpeta data/');
    console.log('   Coloca tu archivo de productos (.xlsx) en la carpeta data/ y vuelve a ejecutar.');
    process.exit(1);
  }

  const excelPath = path.join(dataDir, excelFiles[0]);
  console.log(`📄 Archivo encontrado: ${excelFiles[0]}`);

  try {
    await connectDatabase();

    // 1. Parsear Excel
    const rawData = parseExcel(excelPath);
    console.log(`📊 Filas leídas: ${rawData.length}`);

    // Mostrar primeras columnas detectadas
    if (rawData.length > 0) {
      console.log(`📋 Columnas detectadas: ${Object.keys(rawData[0]).join(', ')}`);
    }

    // 2. Mapear a formato de producto
    const products = mapExcelToProducts(rawData);
    console.log(`✅ Productos válidos: ${products.length}`);

    // 3. Importar a BD
    let imported = 0;
    let updated = 0;

    const defaultBranchId = process.argv[2] ? parseInt(process.argv[2]) : null;

    for (const product of products) {
      try {
        // Asignar rama por defecto si no viene en el excel
        if (defaultBranchId && !product.branchId) {
            product.branchId = defaultBranchId;
        }

        const result = await catalogService.upsertProduct(product);
        if (result) {
          imported++;
          const branchTag = product.branchId ? `[Sede ${product.branchId}]` : '[Global]';
          console.log(`  ✓ ${branchTag} ${product.name} — $${product.price} COP`);
        }
      } catch (err) {
        console.error(`  ✗ Error con "${product.name}":`, err.message);
      }
    }

    // 4. Marcar productos estrella (el más caro de cada categoría)
    const categories = ['CONEXION_PAREJA', 'EXPLORACION_SUAVE', 'SORPRESAS_DISCRETAS', 'EXPERIENCIAS_INTENSAS'];
    for (const cat of categories) {
      const topProduct = await prisma.product.findFirst({
        where: { category: cat, isAvailable: true },
        orderBy: { price: 'desc' },
      });
      if (topProduct) {
        await prisma.product.update({
          where: { id: topProduct.id },
          data: { isFeatured: true },
        });
        console.log(`  ⭐ Producto estrella [${cat}]: ${topProduct.name}`);
      }
    }

    console.log(`\n🎉 Importación completada: ${imported} productos importados`);

  } catch (error) {
    console.error('❌ Error en la importación:', error);
  } finally {
    await prisma.$disconnect();
  }
}

importProducts();

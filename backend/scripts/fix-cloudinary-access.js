// ─────────────────────────────────────────────────────────
//  SCRIPT: Hacer públicas todas las imágenes en Cloudinary
//  Uso: node scripts/fix-cloudinary-access.js
// ─────────────────────────────────────────────────────────
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cloudinary = require('../src/config/cloudinary');

async function fixAccess() {
  console.log('🔍 Buscando imágenes en carpetas de Fantasias...\n');

  const folders = ['fantasias/products', 'fantasias_products'];
  let totalFixed = 0;
  let totalFailed = 0;

  for (const folder of folders) {
    console.log(`\n📁 Procesando carpeta: ${folder}`);
    let nextCursor = null;

    do {
      const options = { type: 'upload', max_results: 100, prefix: folder };
      if (nextCursor) options.next_cursor = nextCursor;

      const result = await cloudinary.api.resources(options);
      const resources = result.resources || [];
      console.log(`   Encontradas: ${resources.length} imágenes`);

      for (const resource of resources) {
        try {
          await cloudinary.uploader.explicit(resource.public_id, {
            type: 'upload',
            access_mode: 'public',
          });
          process.stdout.write('✅');
          totalFixed++;
        } catch (err) {
          process.stdout.write('❌');
          totalFailed++;
          console.error(`\n   Error en ${resource.public_id}:`, err.message);
        }
      }

      nextCursor = result.next_cursor;
    } while (nextCursor);
  }

  console.log(`\n\n═══════════════════════════════`);
  console.log(`✅ Arregladas: ${totalFixed}`);
  console.log(`❌ Fallidas:   ${totalFailed}`);
  console.log(`═══════════════════════════════`);
  console.log('\n🎉 Listo. Re-carga la página de productos en producción.\n');
}

fixAccess().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});

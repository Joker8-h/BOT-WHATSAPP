const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando borrado masivo de productos...');
  try {
    // 1. Borrar dependencias (OrderItems) que referencian a los productos
    const deletedItems = await prisma.orderItem.deleteMany({});
    console.log(`🧹 Se han eliminado ${deletedItems.count} items de pedidos relacionados con los productos.`);

    // 2. Borrar todos los productos de la base de datos
    const result = await prisma.product.deleteMany({});
    console.log(`✅ ¡Éxito! Se han eliminado ${result.count} productos de la base de datos de Fantasías.`);
  } catch (error) {
    console.error('❌ Error eliminando productos:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

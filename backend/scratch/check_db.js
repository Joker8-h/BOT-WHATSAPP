const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const branches = await prisma.branch.findMany({ select: { id: true, name: true, city: true } });
  console.log('--- SUCURSALES ---');
  console.log(branches);

  const categories = await prisma.product.groupBy({
    by: ['branchId', 'category'],
    _count: { _all: true }
  });
  console.log('\n--- PRODUCTOS POR SUCURSAL Y CATEGORÍA ---');
  categories.forEach(c => {
    console.log(`Branch ${c.branchId} | Categoría: ${c.category} | Cantidad: ${c._count._all}`);
  });

  const featured = await prisma.product.findMany({
    where: { isFeatured: true },
    select: { id: true, name: true, branchId: true }
  });
  console.log('\n--- PRODUCTOS ESTRELLA ---');
  console.log(featured);

  process.exit(0);
}

check();

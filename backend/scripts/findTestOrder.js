const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findOrder() {
  const order = await prisma.order.findFirst({
    include: { branch: true }
  });
  if (order) {
    console.log('ORDER_ID:' + order.id);
    console.log('BRANCH_ID:' + order.branchId);
  } else {
    console.log('NO_ORDER');
  }
  await prisma.$disconnect();
}

findOrder();

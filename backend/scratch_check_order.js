const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: { contact: { phone: { contains: '66245659480247' } } },
    include: { items: { include: { product: true } }, contact: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.dir(orders, {depth: null});
  
  const conversation = await prisma.conversation.findFirst({
    where: { contact: { phone: { contains: '66245659480247' } } },
    orderBy: { updatedAt: 'desc' }
  });
  
  const msgs = await prisma.message.findMany({
    where: { conversationId: conversation?.id },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log("Last messages:");
  console.dir(msgs, {depth: null});
}

main().catch(console.error).finally(() => prisma.$disconnect());

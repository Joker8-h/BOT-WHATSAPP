require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const branches = await prisma.branch.findMany({ select: { id: true, name: true, notificationPhone: true } });
  console.log('BRANCHES:' + JSON.stringify(branches));
  const target = '573166575904';
  const upd = await prisma.branch.updateMany({ data: { notificationPhone: target } });
  console.log('UPDATED:' + upd.count);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR:' + e.message); process.exit(1); });

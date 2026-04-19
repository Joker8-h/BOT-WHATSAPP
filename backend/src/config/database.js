// ─────────────────────────────────────────────────────────
//  CONFIG: Database (Prisma + MySQL)
// ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ Conectado a MySQL');
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error.message);
    throw error;
  }
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log('🔌 Desconectado de MySQL');
}

module.exports = { prisma, connectDatabase, disconnectDatabase };

// Deja un solo pedido por transacción de Wompi antes de crear el índice único.
// El resto conserva el pedido, pero suelta el id para no bloquear el arranque.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    const emptied = await prisma.$executeRawUnsafe(`
      UPDATE \`Order\`
      SET wompiTransactionId = NULL
      WHERE wompiTransactionId = ''
    `);
    const cleared = await prisma.$executeRawUnsafe(`
      UPDATE \`Order\` o
      INNER JOIN (
        SELECT wompiTransactionId, MIN(id) AS keepId
        FROM \`Order\`
        WHERE wompiTransactionId IS NOT NULL
        GROUP BY wompiTransactionId
        HAVING COUNT(*) > 1
      ) d ON o.wompiTransactionId = d.wompiTransactionId AND o.id <> d.keepId
      SET o.wompiTransactionId = NULL
    `);
    console.log(`✅ Transacciones Wompi duplicadas liberadas: ${Number(cleared) || 0} (vacías: ${Number(emptied) || 0})`);
  } catch (error) {
    const msg = error.message || String(error);
    if (/doesn't exist|does not exist|Unknown column|Unknown table/i.test(msg)) {
      console.log('ℹ️ Sin tabla Order todavía, se omite la limpieza.');
      return;
    }
    console.error('❌ No se pudieron limpiar transacciones Wompi duplicadas:', msg);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();

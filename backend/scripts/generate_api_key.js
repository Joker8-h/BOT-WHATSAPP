const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const name = process.argv[2] || 'Cliente externo';
  const permissions = process.argv[3] || 'products:read,stock:write';
  const branchId = process.argv[4] ? parseInt(process.argv[4]) : null;

  // Generar llave aleatoria
  const rawKey = 'fantasias_' + crypto.randomBytes(24).toString('hex');
  const hashed = crypto.createHash('sha256').update(rawKey).digest('hex');

  const record = await prisma.apiKey.create({
    data: {
      key: hashed,
      name,
      permissions,
      branchId,
      isActive: true
    }
  });

  console.log('\n========================================');
  console.log('✅ API Key generada exitosamente');
  console.log('========================================');
  console.log(`  Nombre:      ${name}`);
  console.log(`  Permisos:    ${permissions}`);
  console.log(`  Sucursal:    ${branchId || 'Todas'}`);
  console.log(`  ID interno:  ${record.id}`);
  console.log('──────────────────────────────────────────');
  console.log(`  API Key:     ${rawKey}`);
  console.log('========================================');
  console.log('⚠️  Guarda esta llave en un lugar seguro.');
  console.log('   No podrás verla nuevamente.\n');

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

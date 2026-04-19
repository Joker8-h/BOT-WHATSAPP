const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando base de datos...');

  // 1. Crear Sucursal Central (Infraestructura SaaS)
  const mainBranch = await prisma.branch.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: 'Fantasías Central',
      city: 'Administración Global',
      address: 'N/A',
      phone: '0000000000',
      isActive: true,
      isAuthorized: true
    }
  });
  console.log('✅ Infraestructura base creada: Fantasías Central');

  // 2. Crear Admin Master
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Fantasias2024!';
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {
        password: hashedPassword,
        role: 'ADMIN',
        isApproved: true,
        branchId: mainBranch.id
    },
    create: {
      username: adminUsername,
      email: 'admin@fantasias.com',
      password: hashedPassword,
      role: 'ADMIN',
      isApproved: true,
      isActive: true,
      branchId: mainBranch.id
    }
  });
  console.log('✅ Administrador Master configurado:', adminUser.username);

  console.log('✨ Semilla completada con éxito.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

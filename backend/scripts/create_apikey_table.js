const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.$queryRawUnsafe("SHOW TABLES LIKE 'ApiKey'");
  if (result.length > 0) {
    console.log('ApiKey table already exists');
  } else {
    console.log('Creating ApiKey table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE ApiKey (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        description TEXT NULL,
        branchId INT NULL,
        isActive BOOLEAN DEFAULT TRUE,
        permissions VARCHAR(255) DEFAULT 'products:read',
        lastUsedAt DATETIME NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX ApiKey_branchId_idx (branchId),
        FOREIGN KEY (branchId) REFERENCES Branch(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('ApiKey table created successfully');
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });

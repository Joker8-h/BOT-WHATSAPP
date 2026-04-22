const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEmployees() {
  const employees = await prisma.employeeAccess.findMany({
    include: { branch: true }
  });
  console.log('--- EMPLEADOS CONFIGURADOS ---');
  employees.forEach(e => {
    console.log(`Nombre: ${e.name}, Tel: ${e.phone}, Sucursal: ${e.branch.name} (ID: ${e.branchId})`);
  });
  if (employees.length === 0) console.log('No hay empleados en la base de datos.');
  await prisma.$disconnect();
}

checkEmployees();

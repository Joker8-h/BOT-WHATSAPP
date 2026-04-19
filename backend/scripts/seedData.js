// ─────────────────────────────────────────────────────────
//  SCRIPT: Seed Data — Datos iniciales para testing
//  Uso: npm run seed
// ─────────────────────────────────────────────────────────
require('dotenv').config();
const { prisma, connectDatabase } = require('../src/config/database');

async function seedData() {
  console.log('🌱 Sembrando datos iniciales...\n');

  await connectDatabase();

  // ── Productos de ejemplo ──
  const products = [
    // 💕 Conexión en pareja
    {
      name: 'Kit Romántico Esencial',
      description: 'Set completo para una noche especial',
      price: 89000,
      category: 'CONEXION_PAREJA',
      emotionalDesc: 'Todo lo que necesitas para crear una noche mágica de reconexión. Un kit que habla por sí solo y transforma cualquier momento en algo inolvidable.',
      isFeatured: true,
      stock: 25,
      excelRef: 'SEED-001',
    },
    {
      name: 'Velas Aromáticas Sensuales',
      description: 'Set de 3 velas con aromas afrodisíacos',
      price: 45000,
      category: 'CONEXION_PAREJA',
      emotionalDesc: 'Enciende la atmósfera perfecta con aromas que despiertan los sentidos y crean el ambiente ideal para esos momentos a solas.',
      isFeatured: false,
      stock: 50,
      excelRef: 'SEED-002',
    },
    {
      name: 'Aceite de Masaje Premium',
      description: 'Aceite tibio con aroma de vainilla y canela',
      price: 55000,
      category: 'CONEXION_PAREJA',
      emotionalDesc: 'Un masaje es el lenguaje del cuerpo. Este aceite premium transforma tus manos en la mejor herramienta de conexión.',
      isFeatured: false,
      stock: 35,
      excelRef: 'SEED-003',
    },

    // ✨ Exploración suave
    {
      name: 'Set Descubrimiento',
      description: 'Kit de exploración para principiantes',
      price: 120000,
      category: 'EXPLORACION_SUAVE',
      emotionalDesc: 'Diseñado especialmente para quienes quieren dar el primer paso hacia algo nuevo. Suave, elegante y lleno de posibilidades.',
      isFeatured: true,
      stock: 20,
      excelRef: 'SEED-004',
    },
    {
      name: 'Antifaz de Seda',
      description: 'Antifaz suave de seda natural',
      price: 35000,
      category: 'EXPLORACION_SUAVE',
      emotionalDesc: 'Cuando cierras los ojos, los demás sentidos se intensifican. Un simple antifaz puede transformar completamente la experiencia.',
      isFeatured: false,
      stock: 40,
      excelRef: 'SEED-005',
    },

    // 🎁 Sorpresas discretas
    {
      name: 'Caja Sorpresa Fantasías',
      description: 'Caja misteriosa con productos seleccionados',
      price: 150000,
      category: 'SORPRESAS_DISCRETAS',
      emotionalDesc: 'La emoción de lo desconocido. Una caja curada con nuestros mejores productos para quienes aman las sorpresas.',
      isFeatured: true,
      stock: 15,
      excelRef: 'SEED-006',
    },
    {
      name: 'Dado Atrevido',
      description: 'Dado con actividades divertidas para parejas',
      price: 25000,
      category: 'SORPRESAS_DISCRETAS',
      emotionalDesc: 'Deja que el azar decida la diversión de esta noche. Un juego que rompe la rutina con una sola tirada.',
      isFeatured: false,
      stock: 60,
      excelRef: 'SEED-007',
    },

    // 🔥 Experiencias intensas
    {
      name: 'Experience Box Premium',
      description: 'Set premium con productos de alta gama',
      price: 280000,
      category: 'EXPERIENCIAS_INTENSAS',
      emotionalDesc: 'Para quienes buscan llevar cada momento al máximo nivel. Una experiencia premium que redefine los límites de la conexión.',
      isFeatured: true,
      stock: 10,
      excelRef: 'SEED-008',
    },
    {
      name: 'Set Fantasía Completa',
      description: 'El set más completo de la colección',
      price: 350000,
      category: 'EXPERIENCIAS_INTENSAS',
      emotionalDesc: 'Nuestra pieza maestra. Todo lo que necesitas para una experiencia que recordarás siempre.',
      isFeatured: false,
      stock: 8,
      excelRef: 'SEED-009',
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: products.indexOf(product) + 1 },
      create: { ...product, isAvailable: true },
      update: product,
    });
    console.log(`  ✓ ${product.name} — ${product.price.toLocaleString()} COP`);
  }

  console.log(`\n✅ ${products.length} productos creados`);

  // ── Contactos de ejemplo ──
  const contacts = [
    { phone: '573001234567', name: 'María García', city: 'Bogotá', clientType: 'EXPLORADOR' },
    { phone: '573009876543', name: 'Carlos López', city: 'Medellín', clientType: 'TIMIDO' },
    { phone: '573005555555', name: 'Laura Martínez', city: 'Cali', clientType: 'DECIDIDO' },
    { phone: '573002222222', name: 'Andrés Rodríguez', city: 'Barranquilla', clientType: 'RECURRENTE', totalPurchases: 3 },
    { phone: '573003333333', name: 'Sofía Hernández', city: 'Bogotá', clientType: 'NUEVO' },
  ];

  for (const contact of contacts) {
    await prisma.contact.upsert({
      where: { phone: contact.phone },
      create: contact,
      update: contact,
    });
    console.log(`  ✓ ${contact.name} (${contact.city})`);
  }

  console.log(`\n✅ ${contacts.length} contactos de ejemplo creados`);
  console.log('\n🎉 Seed completado!');

  await prisma.$disconnect();
}

seedData().catch(console.error);

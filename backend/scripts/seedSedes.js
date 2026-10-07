const { prisma } = require('../src/config/database');

async function seedSedes() {
  console.log('🌱 Sembrando sedes y empleados...\n');

  // ── SEDE POPAYÁN ──
  const popayan = await prisma.branch.upsert({
    where: { id: 1 },
    update: {
      address: 'Cra 10A # 1AN-09, Barrio Modelo (esquina)',
      referencePoint: 'Sobre la misma cuadra del Gimnasio de la Salud',
      notes: null,
      storeFrontDesc: null,
      notificationPhone: '573126279506',
    },
    create: {
      id: 1,
      name: 'Fantasías Popayán',
      city: 'Popayán',
      address: 'Cra 10A # 1AN-09, Barrio Modelo (esquina)',
      phone: '',
      referencePoint: 'Sobre la misma cuadra del Gimnasio de la Salud',
      notificationPhone: '573126279506',
      isActive: true,
      isAuthorized: true,
    },
  });
  console.log(`✅ Sede: ${popayan.name} | Notif: ${popayan.notificationPhone || 'NO CONFIGURADO'}`);

  // ── SEDE FLORENCIA ──
  const florencia = await prisma.branch.upsert({
    where: { id: 2 },
    update: {
      address: 'Calle 18 # 10-04, Barrio Centro',
      referencePoint: 'Sobre la misma cuadra de la transportadora ENVÍA',
      storeFrontDesc: 'Fachada de dos pisos muy grande de color negro',
      notificationPhone: '573126279506',
      notes: null,
    },
    create: {
      id: 2,
      name: 'Fantasías Florencia',
      city: 'Florencia',
      address: 'Calle 18 # 10-04, Barrio Centro',
      phone: '',
      referencePoint: 'Sobre la misma cuadra de la transportadora ENVÍA',
      storeFrontDesc: 'Fachada de dos pisos muy grande de color negro',
      notificationPhone: '573126279506',
      isActive: true,
      isAuthorized: true,
    },
  });
  console.log(`✅ Sede: ${florencia.name} | Notif: ${florencia.notificationPhone || '⚠️ SIN CONFIGURAR'}`);

  // ── SEDE PITALITO ──
  const pitalito = await prisma.branch.upsert({
    where: { id: 3 },
    update: {
      address: 'Cll 14 7 24, Barrio Guaduales',
      notes: 'Aunque estamos funcionando de manera provisional y unificada con el local Pink Rouse, tenemos la mayoría de nuestros productos listos para entregar. Las personas pueden ir a este punto a comprar o también entregamos a domicilio.',
      notificationPhone: '573126279506',
      referencePoint: null,
      storeFrontDesc: null,
    },
    create: {
      id: 3,
      name: 'Fantasías Pitalito',
      city: 'Pitalito',
      address: 'Cll 14 7 24, Barrio Guaduales',
      phone: '',
      notificationPhone: '573126279506',
      notes: 'Aunque estamos funcionando de manera provisional y unificada con el local Pink Rouse, tenemos la mayoría de nuestros productos listos para entregar. Las personas pueden ir a este punto a comprar o también entregamos a domicilio.',
      isActive: true,
      isAuthorized: true,
    },
  });
  console.log(`✅ Sede: ${pitalito.name} | Notif: ${pitalito.notificationPhone || '⚠️ SIN CONFIGURAR'}`);

  // ── SEDE YOPAL ──
  const yopal = await prisma.branch.upsert({
    where: { id: 4 },
    update: {
      address: 'Calle 9 # 23-52, Barrio Centro',
      referencePoint: 'Frente al restaurante Rapi Roy',
      storeFrontDesc: 'Fachada amplia de cristal y pared de color negro',
      notificationPhone: '573126279506',
      notes: 'Estamos próximos a trasladarnos, estamos en búsqueda de local para mejorar nuestras instalaciones para beneficio de nuestros clientes. En caso de que sepa de un local de aproximadamente 100 a 200 metros cuadrados agradeceríamos. Si no, nos instalamos en una bodega provisional y seguimos entregando a domicilio mientras nos ubicamos bien.',
    },
    create: {
      id: 4,
      name: 'Fantasías Yopal',
      city: 'Yopal',
      address: 'Calle 9 # 23-52, Barrio Centro',
      phone: '',
      referencePoint: 'Frente al restaurante Rapi Roy',
      storeFrontDesc: 'Fachada amplia de cristal y pared de color negro',
      notificationPhone: '573126279506',
      isActive: true,
      isAuthorized: true,
    },
  });
  console.log(`✅ Sede: ${yopal.name} | Notif: ${yopal.notificationPhone || '⚠️ SIN CONFIGURAR'}`);

  // ── EMPLEADOS ──
  const employees = [
    // Popayán
    { phone: '3044401538', name: 'Daniela Gomez', role: 'Encargada', description: 'Encargada de entregas, ventas, inventarios, gastos y todo lo relacionado con administración y servicio al cliente', branchId: 1 },
    { phone: '3227246389', name: 'Faisury Triana', role: 'Encargada', description: 'Encargada de entregas, ventas, inventarios, gastos y todo lo relacionado con administración y servicio al cliente', branchId: 1 },
    // Florencia
    { phone: '3208923129', name: 'Martha Escalante', role: 'Encargada', description: 'Encargada de entregas, ventas, inventarios, gastos y todo lo relacionado con administración y servicio al cliente', branchId: 2 },
    // Pitalito
    { phone: '3132066880', name: 'Angela Hernandez', role: 'Asesora de ventas', description: 'Encargada de entregas, inventarios, gastos y facturación', branchId: 3 },
    // Yopal
    { phone: '3017065565', name: 'Viviana Manotas', role: 'Asesora comercial', description: 'Encargada de entregas, ventas, inventarios, gastos y todo lo relacionado con administración y servicio al cliente', branchId: 4 },
  ];

  for (const emp of employees) {
    const saved = await prisma.employeeAccess.upsert({
      where: { phone_branchId: { phone: emp.phone, branchId: emp.branchId } },
      update: { name: emp.name, role: emp.role, description: emp.description },
      create: emp,
    });
    console.log(`  👤 ${saved.name} — ${saved.role} (Sede ${saved.branchId})`);
  }

  // ── CONFIGURACIÓN AUTOMÁTICA DE WOMPI DESDE ENV ──
  const { encrypt } = require('../src/utils/encryption');
  const wompiPrivate = process.env.WOMPI_PRIVATE_KEY?.trim();
  const wompiPublic = process.env.WOMPI_PUBLIC_KEY?.trim();
  const wompiIntegrity = process.env.WOMPI_INTEGRITY_SECRET?.trim();
  const wompiEvents = process.env.WOMPI_EVENTS_SECRET?.trim();

  if (wompiPrivate && wompiPublic) {
    const wompiData = {
      wompiPrivateKey: encrypt(wompiPrivate),
      wompiPublicKey: encrypt(wompiPublic),
    };
    if (wompiIntegrity) wompiData.wompiIntegritySecret = encrypt(wompiIntegrity);
    if (wompiEvents) wompiData.wompiEventsSecret = encrypt(wompiEvents);

    await prisma.branch.updateMany({
      data: wompiData
    });
    console.log('💳 Wompi: Credenciales sincronizadas en todas las sedes.');
  }

  console.log('\n✅ Seed de sedes y empleados completado.');
  process.exit(0);
}

seedSedes().catch((e) => {
  console.error('❌ Error en seed:', e);
  process.exit(1);
});

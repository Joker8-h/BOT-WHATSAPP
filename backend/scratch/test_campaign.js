const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const campaignService = require('../src/services/campaignService');
const whatsappService = require('../src/services/whatsappService');

async function runTest() {
  console.log('🚀 Iniciando prueba técnica de campaña para YOPAL (Branch 2)...');
  
  // 1. Inyectar dependencias (importante para evitar circulares)
  campaignService.setWhatsAppService(whatsappService);

  // 2. Verificar si WhatsApp está listo para Branch 2
  const status = whatsappService.getBranchStatus(2);
  console.log('📊 Estado WhatsApp Branch 2:', status);

  if (!status.isReady) {
    console.error('❌ WhatsApp para Yopal no está READY. Por favor conéctalo en el dashboard primero.');
    process.exit(1);
  }

  // 3. Crear una campaña de prueba
  const campaign = await prisma.campaign.create({
    data: {
      name: 'PRUEBA TÉCNICA - YOPAL',
      message: '¡Hola! Esta es una prueba del sistema de campañas de Fantasías. 🌹 Disculpa las molestias, estamos validando la conexión.',
      branchId: 2,
      targetFilter: { clientType: 'NUEVO' },
      status: 'DRAFT',
      totalTargets: 1
    }
  });

  console.log(`✅ Campaña de prueba creada con ID: ${campaign.id}`);

  // 4. Ejecutar campaña
  console.log('🔄 Ejecutando envío...');
  const result = await campaignService.executeCampaign(campaign.id);
  
  console.log('📊 Resultado de inicio:', result);
  console.log('⏳ El envío se procesará en segundo plano (background). Revisa los logs de la consola del servidor.');
  
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Error en la prueba:', err);
  process.exit(1);
});

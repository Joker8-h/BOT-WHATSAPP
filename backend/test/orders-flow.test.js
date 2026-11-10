const test = require('node:test');
const assert = require('node:assert/strict');

const catalogService = require('../src/services/catalogService');
const aiService = require('../src/services/aiService');
const messageController = require('../src/controllers/messageController');
const crmService = require('../src/services/crmService');
const { prisma } = require('../src/config/database');
const wompiController = require('../src/controllers/wompiController');
const whatsappService = require('../src/services/whatsappService');
const ownerAlertService = require('../src/services/ownerAlertService');

test('descarta un barrio inventado y conserva uno indicado por el cliente', () => {
  const invented = { capturedNeighborhood: 'Centro' };
  aiService.validateCapturedData(invented, 'Bogotá, carrera 10 #4-50');
  assert.equal(invented.capturedNeighborhood, undefined);
  const supplied = { capturedNeighborhood: 'Modelo' };
  aiService.validateCapturedData(supplied, 'calle 5', [{ role: 'USER', content: 'Mi barrio es Modelo' }]);
  assert.equal(supplied.capturedNeighborhood, 'Modelo');
});

test('el cierre solicita datos faltantes antes de registrar o cobrar', async () => {
  const imageService = require('../src/services/productImageService');
  const targets = [
    [crmService, 'patchContext', async () => ({})],
    [crmService, 'saveOrderDraft', async () => ({})],
    [crmService, 'saveMessage', async () => ({})],
    [whatsappService, 'sendMessage', async () => true],
    [imageService, 'pickImages', async () => []],
    [catalogService, 'resolveSaleProducts', async () => { assert.fail('no debe resolver un pedido incompleto'); }],
    [messageController, 'splitMessageNaturally', (text) => [text]],
  ];
  const originals = targets.map(([obj, key]) => obj[key]);
  targets.forEach(([obj, key, value]) => { obj[key] = value; });
  try {
    for (const field of ['name', 'deliveryPhone', 'address', 'city']) {
      const contact = { id: 1, name: 'Cliente Prueba', deliveryPhone: '3150001122', address: 'calle 5 #12-34', city: 'Popayán' };
      contact[field] = null;
      const actions = { shouldCloseSale: true, productsToSell: ['Producto de prueba'] };
      await messageController.processAiResult({ aiResult: { response: 'Voy a registrar el pedido', flow: 'CLOSING', actions }, contact, conversation: { id: 1, context: {} }, chatId: 'test@c.us', branchId: 1 });
      assert.equal(actions.shouldCloseSale, false, field);
      assert.equal(actions.shouldCreateContraEntrega, false, field);
    }
  } finally {
    targets.forEach(([obj, key], i) => { obj[key] = originals[i]; });
  }
});

test('un pago sin inventario queda en revisión sin confirmar despacho', async () => {
  const originals = [prisma.$transaction, prisma.order.update, whatsappService.sendMessage, ownerAlertService.onPaymentOrphan];
  const calls = [];
  prisma.$transaction = async () => { throw new Error('inventario insuficiente'); };
  prisma.order.update = async () => calls.push('revision');
  whatsappService.sendMessage = async () => calls.push('confirmacion');
  ownerAlertService.onPaymentOrphan = async () => calls.push('alerta');
  try {
    await wompiController._afterApproved({ id: 1, items: [], contact: {} }, { id: 'test' }, null);
    assert.deepEqual(calls, ['revision', 'alerta']);
  } finally {
    [prisma.$transaction, prisma.order.update, whatsappService.sendMessage, ownerAlertService.onPaymentOrphan] = originals;
  }
});

test('contraentrega rechaza cantidades negativas antes de tocar inventario', async () => {
  await assert.rejects(crmService.createOrderAndReserveStock({ items: [{ productId: 1, quantity: -1 }], amount: 1000 }), /Pedido inválido/);
});

test('un pago con monto incorrecto no confirma compra ni solicita despacho', async () => {
  const originalUpdate = prisma.order.update;
  const originalSend = whatsappService.sendMessage;
  const originalRecord = crmService.recordPurchase;
  const originalNotify = whatsappService.notifyPhone;
  const calls = [];
  prisma.order.update = async () => calls.push('revision');
  whatsappService.sendMessage = async () => calls.push('confirmacion');
  crmService.recordPurchase = async () => calls.push('compra');
  whatsappService.notifyPhone = async () => calls.push('despacho');
  try {
    await wompiController._afterApproved({ id: 1, items: [], contact: {}, amount: 10000 }, { id: 'test', amount_in_cents: 100 }, null, { mismatch: true });
    assert.deepEqual(calls, ['revision']);
  } finally {
    prisma.order.update = originalUpdate;
    whatsappService.sendMessage = originalSend;
    crmService.recordPurchase = originalRecord;
    whatsappService.notifyPhone = originalNotify;
  }
});

test('parsea cantidades escritas en español sin romper el nombre del producto', () => {
  assert.deepEqual(catalogService._parseQuantity('quiero dos lubricantes íntimos'), {
    name: 'lubricantes íntimos',
    quantity: 2,
  });
  assert.deepEqual(catalogService._parseQuantity('un par de anillos'), {
    name: 'anillos',
    quantity: 2,
  });
});

test('captura los datos de entrega desde un mensaje completo', () => {
  const data = messageController._extractCustomerDataFromText(
    'Soy Carlos Ruiz, vivo en Popayán, calle 5 # 12-34, barrio Modelo, mi número es 3150001122'
  );

  assert.equal(data.name, 'Carlos Ruiz');
  assert.equal(data.city, 'Popayán');
  assert.equal(data.address, 'calle 5 # 12-34');
  assert.equal(data.neighborhood, 'Modelo');
  assert.equal(data.deliveryPhone, '3150001122');
});

test('parsea cierres y conserva el método de pago indicado', () => {
  const actions = aiService.parseActions(
    '[CAPTURAR_METODO_PAGO: Nequi] [CAPTURAR_CIUDAD: Popayán] [CERRAR_VENTA: Lubricante íntimo x2]'
  );

  assert.equal(actions.capturedPaymentMethod, 'wompi');
  assert.equal(actions.shouldCloseSale, true);
  assert.equal(actions.shouldCreateContraEntrega, false);
  assert.deepEqual(actions.productsToSell, ['Lubricante íntimo x2']);
});

test('consulta también conversaciones escaladas para no perder el contexto humano', async () => {
  const originalFindFirst = prisma.conversation.findFirst;
  prisma.conversation.findFirst = async (args) => {
    assert.deepEqual(args.where.status, { in: ['ACTIVE', 'PAUSED', 'ESCALATED'] });
    return { id: 77, status: 'ESCALATED', context: {}, messages: [] };
  };

  try {
    const conversation = await crmService.getActiveConversation(12, 1);
    assert.equal(conversation.id, 77);
    assert.equal(conversation.status, 'ESCALATED');
  } finally {
    prisma.conversation.findFirst = originalFindFirst;
  }
});

test('rechaza un pedido si el stock cambió antes de reservarlo', async () => {
  const originalTransaction = prisma.$transaction;
  let orderCreated = false;
  prisma.$transaction = async (callback) => callback({
    product: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => ({ stock: 0 }),
      update: async () => undefined,
    },
    order: {
      create: async () => {
        orderCreated = true;
        return { id: 1 };
      },
    },
  });

  try {
    await assert.rejects(
      crmService.createOrderAndReserveStock({
        contactId: 1,
        branchId: 1,
        items: [{ productId: 10, quantity: 1, price: 1000 }],
        amount: 1000,
      }),
      (error) => error.code === 'INSUFFICIENT_STOCK'
    );
    assert.equal(orderCreated, false);
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

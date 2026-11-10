const test = require('node:test');
const assert = require('node:assert/strict');
const crm = require('../src/services/crmService');
const { prisma } = require('../src/config/database');

test('cambiar cantidad o quitar productos no se confunde con un duplicado', async () => {
  const original = prisma.order.findFirst;
  prisma.order.findFirst = async () => ({ id: 1, items: [{ productId: 2, quantity: 2 }, { productId: 3, quantity: 1 }] });
  try {
    assert.equal(await crm.findRecentSimilarOrder(1, 'CONTRAENTREGA', [{ productId: 2, quantity: 1 }]), null);
    assert.equal((await crm.findRecentSimilarOrder(1, 'CONTRAENTREGA', [{ productId: 2, quantity: 2 }, { productId: 3, quantity: 1 }])).id, 1);
  } finally { prisma.order.findFirst = original; }
});

test('cancelar un contraentrega restaura stock una sola vez', async () => {
  const order = { id: 1, status: 'PENDING', paymentMethod: 'CONTRAENTREGA', items: [{ productId: 2, quantity: 3 }] };
  let stock = 0;
  const database = { $transaction: fn => fn({
    order: { findUnique: async () => ({ ...order }), updateMany: async ({ data }) => { Object.assign(order, data); return { count: 1 }; } },
    product: { update: async ({ data }) => { stock += data.stock.increment; } },
  }) };
  await crm.cancelOrder(1, {}, database);
  await crm.cancelOrder(1, {}, database);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(stock, 3);
  assert.equal(order.postSaleNextAt, null);
});

test('cancelar link sin pago no incrementa inventario sin reservar', async () => {
  const database = { $transaction: fn => fn({
    order: { findUnique: async () => ({ id: 1, status: 'PAYMENT_SENT', paymentMethod: 'WOMPI', items: [{ quantity: 1 }] }), updateMany: async () => ({ count: 1 }) },
    product: { update: async () => { assert.fail('no había reserva'); } },
  }) };
  await crm.cancelOrder(1, {}, database);
});

test('rechaza cancelación automática después del despacho', async () => {
  const database = { $transaction: fn => fn({ order: { findUnique: async () => ({ status: 'SHIPPED' }) } }) };
  await assert.rejects(crm.cancelOrder(1, {}, database), e => e.code === 'ORDER_CONFLICT');
});

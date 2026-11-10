// Prueba la creación real de pedido y su reserva usando registros sintéticos.
// La transacción externa se revierte siempre: nunca confirma estos registros.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../src/config/database');
const crm = require('../src/services/crmService');

async function scenario(insufficient) {
  const marker = `test-${randomUUID()}`;
  const rollback = new Error('EXPECTED_TEST_ROLLBACK');
  let contactId;
  let productId;
  let verified = false;
  try {
    await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { isActive: true }, select: { id: true } });
      assert.ok(branch, 'Se requiere una sede existente');
      const contact = await tx.contact.create({ data: { phone: marker, name: 'PRUEBA SIN DESPACHO', branchId: branch.id } });
      const product = await tx.product.create({ data: { name: marker, category: 'CONEXION_PAREJA', branchId: branch.id, price: 5000, stock: 2, isAvailable: true } });
      contactId = contact.id;
      productId = product.id;
      const input = { contactId, branchId: branch.id, items: [{ productId, quantity: insufficient ? 3 : 2, price: 5000 }], amount: 16000, shippingCity: 'Popayán', shippingAddress: 'DIRECCIÓN SINTÉTICA - NO DESPACHAR', paymentMethod: 'CONTRAENTREGA', notes: marker };
      const database = { $transaction: callback => callback(tx) };
      if (insufficient) {
        await assert.rejects(crm.createOrderAndReserveStock(input, database), error => error.code === 'INSUFFICIENT_STOCK');
        assert.equal(await tx.order.count({ where: { contactId } }), 0);
        assert.equal((await tx.product.findUnique({ where: { id: productId } })).stock, 2);
      } else {
        const order = await crm.createOrderAndReserveStock(input, database);
        assert.equal(Number(order.amount), 16000);
        const stock = await tx.product.findUnique({ where: { id: productId } });
        assert.equal(stock.stock, 0);
        assert.equal(stock.isAvailable, false);
        const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
        assert.equal(items.length, 1);
        assert.equal(items[0].quantity, 2);
        await crm.cancelOrder(order.id, {}, database);
        assert.equal((await tx.product.findUnique({ where: { id: productId } })).stock, 2);
        await crm.cancelOrder(order.id, {}, database);
        assert.equal((await tx.product.findUnique({ where: { id: productId } })).stock, 2, 'Cancelar dos veces no duplica inventario');
      }
      verified = true;
      throw rollback;
    }, { timeout: 20000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.ok(verified);
  assert.equal(await prisma.contact.count({ where: { id: contactId } }), 0);
  assert.equal(await prisma.product.count({ where: { id: productId } }), 0);
  assert.equal(await prisma.order.count({ where: { contactId } }), 0);
  console.log(insufficient ? 'PASS: stock insuficiente bloquea pedido; rollback confirmado' : 'PASS: pedido e inventario correctos; rollback confirmado');
}

(async () => {
  await scenario(false);
  await scenario(true);
})().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

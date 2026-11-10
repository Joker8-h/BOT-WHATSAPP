const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const service = require('../src/services/wompiService');
const controller = require('../src/controllers/wompiController');
const { prisma } = require('../src/config/database');

test('confirmaciones de pago conservan LID y normalizan celulares colombianos', () => {
  assert.equal(controller._customerChatId('123456789012345@lid'), '123456789012345@lid');
  assert.equal(controller._customerChatId('3150001122'), '573150001122@c.us');
});

test('firma Wompi: acepta evento firmado y rechaza monto alterado', () => {
  const secret = 'synthetic-test-secret';
  const body = {
    timestamp: 1700000000,
    data: { transaction: { id: 'test-tx', status: 'APPROVED', amount_in_cents: 1500000 } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] },
  };
  body.signature.checksum = crypto.createHash('sha256').update(`test-txAPPROVED1500000${body.timestamp}${secret}`).digest('hex');
  assert.equal(service.isValidWebhookChecksum(body, secret), true);
  body.data.transaction.amount_in_cents = 1;
  assert.equal(service.isValidWebhookChecksum(body, secret), false);
  assert.equal(service.isValidWebhookChecksum({}, secret), false);
});

test('webhook rechaza firma inválida sin consultar pedidos', async () => {
  const original = controller._isAuthentic;
  controller._isAuthentic = async () => false;
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await controller.handleWebhook({ body: {}, headers: {}, ip: 'test' }, res);
    assert.equal(res.code, 401);
  } finally { controller._isAuthentic = original; }
});

test('webhook repetido no crea otro pedido y libera bloqueo', async () => {
  const originals = [controller._isAuthentic, prisma.order.findFirst, controller._handleCartPayment];
  controller._isAuthentic = async () => true;
  prisma.order.findFirst = async () => ({ id: 1 });
  controller._handleCartPayment = async () => { assert.fail('no debe procesar venta repetida'); };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await controller.handleWebhook({ body: { event: 'transaction.updated', data: { transaction: { id: 'duplicate-test' } } }, headers: {} }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.duplicate, true);
    assert.equal(controller._inFlight.has('duplicate-test'), false);
  } finally {
    [controller._isAuthentic, prisma.order.findFirst, controller._handleCartPayment] = originals;
  }
});

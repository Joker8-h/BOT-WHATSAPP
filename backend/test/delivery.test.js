const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/messageController');
const crm = require('../src/services/crmService');
const wompi = require('../src/services/wompiService');
const whatsapp = require('../src/services/whatsappService');

test('mensajes del mismo cliente en dos sedes no se mezclan', () => {
  const chat = 'synthetic@c.us';
  try {
    controller._enqueue(chat, { body: 'sede uno' }, 1);
    controller._enqueue(chat, { body: 'sede dos' }, 2);
    assert.equal(controller.chatQueues.get(`1:${chat}`).items.length, 1);
    assert.equal(controller.chatQueues.get(`2:${chat}`).items.length, 1);
    assert.equal(controller.chatQueues.get(`1:${chat}`).items[0].branchId, 1);
  } finally {
    for (const id of [1, 2]) {
      const key = `${id}:${chat}`;
      clearTimeout(controller.chatQueues.get(key)?.timer);
      controller.chatQueues.delete(key);
    }
  }
});

test('pide confirmar un producto que la IA elige por primera vez al cerrar', async () => {
  const original = [whatsapp.sendMessage, crm.saveMessage];
  const messages = [];
  whatsapp.sendMessage = async (branch, chat, text) => { messages.push(text); return true; };
  crm.saveMessage = async () => ({});
  try {
    const data = { productNames: ['Modelo Premium x2'], body: 'lo llevo', messageHistory: [{ role: 'ASSISTANT', content: '¿Buscas un vibrador?' }] };
    assert.equal(await controller._requestUnselectedProducts(data), true);
    assert.match(messages[0], /Modelo Premium x2/);
    data.messageHistory.push({ role: 'ASSISTANT', content: messages[0] });
    assert.equal(await controller._requestUnselectedProducts(data), false);
    assert.equal(messages.length, 1);
  } finally { [whatsapp.sendMessage, crm.saveMessage] = original; }
});

test('no genera cobro si no pudo guardar el carrito recuperable', async () => {
  const original = [crm.patchContext, wompi.generatePaymentLink];
  let generated = 0;
  crm.patchContext = async () => null;
  wompi.generatePaymentLink = async () => { generated++; return null; };
  try {
    assert.equal(await controller.sendPaymentLink({ conversationId: 1, contact: {}, cartData: { amount: 1000 }, productNames: ['Prueba'] }), null);
    assert.equal(generated, 0);
  } finally { [crm.patchContext, wompi.generatePaymentLink] = original; }
});

test('un link que WhatsApp no entrega no se marca enviado', async () => {
  const original = [crm.patchContext, wompi.generatePaymentLink, whatsapp.sendMessage, crm.setSaleStage, crm.saveMessage];
  let context = {};
  const effects = [];
  crm.patchContext = async (id, fn) => (context = fn(context) || context);
  wompi.generatePaymentLink = async () => ({ id: 'synthetic', url: 'https://example.invalid/test' });
  whatsapp.sendMessage = async () => false;
  crm.setSaleStage = async () => { effects.push('stage'); };
  crm.saveMessage = async () => { effects.push('message'); };
  try {
    assert.equal(await controller.sendPaymentLink({ conversationId: 1, contact: {}, cartData: { amount: 1000, items: [] }, productNames: ['Prueba'] }), null);
    assert.deepEqual(effects, []);
  } finally { [crm.patchContext, wompi.generatePaymentLink, whatsapp.sendMessage, crm.setSaleStage, crm.saveMessage] = original; }
});

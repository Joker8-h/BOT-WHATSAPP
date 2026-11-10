const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GEMINI_API_KEY = 'synthetic-test-key';
const config = require('../src/config/openai');
const { callChatWithFallback } = require('../src/services/aiService');

test('un modelo OpenAI no disponible permite responder al proveedor secundario', async () => {
  const originals = [config.openai.chat.completions.create, config.gemini.chat.completions.create];
  const order = [...config.PROVIDER_ORDER];
  const models = [...config.MODEL_CHAIN];
  const geminiModels = [...config.GEMINI_CHAIN];
  config.PROVIDER_ORDER.splice(0, config.PROVIDER_ORDER.length, 'openai', 'gemini');
  config.MODEL_CHAIN.splice(0, config.MODEL_CHAIN.length, 'retired-test-model');
  config.GEMINI_CHAIN.splice(0, config.GEMINI_CHAIN.length, 'secondary-test-model');
  config.openai.chat.completions.create = async () => { throw Object.assign(new Error('model not found'), { status: 404, code: 'model_not_found' }); };
  config.gemini.chat.completions.create = async () => ({ choices: [{ message: { content: 'Respuesta disponible' } }] });
  try {
    const result = await callChatWithFallback([{ role: 'user', content: 'Prueba sintética' }]);
    assert.equal(result.choices[0].message.content, 'Respuesta disponible');
    assert.equal(result._provider, 'gemini');
  } finally {
    [config.openai.chat.completions.create, config.gemini.chat.completions.create] = originals;
    config.PROVIDER_ORDER.splice(0, config.PROVIDER_ORDER.length, ...order);
    config.MODEL_CHAIN.splice(0, config.MODEL_CHAIN.length, ...models);
    config.GEMINI_CHAIN.splice(0, config.GEMINI_CHAIN.length, ...geminiModels);
  }
});

test('sin saldo OpenAI se pasa al respaldo sin recorrer sus demás modelos', async () => {
  const originals = [config.openai.chat.completions.create, config.gemini.chat.completions.create];
  const order = [...config.PROVIDER_ORDER];
  let calls = 0;
  config.PROVIDER_ORDER.splice(0, config.PROVIDER_ORDER.length, 'openai', 'gemini');
  config.openai.chat.completions.create = async () => {
    calls++;
    throw Object.assign(new Error('You have no credits remaining'), { status: 429, code: 'insufficient_quota' });
  };
  config.gemini.chat.completions.create = async () => ({ choices: [{ message: { content: 'Disponible' } }] });
  try {
    const result = await callChatWithFallback([{ role: 'user', content: 'Prueba' }]);
    assert.equal(result._provider, 'gemini');
    assert.equal(calls, 1);
  } finally {
    [config.openai.chat.completions.create, config.gemini.chat.completions.create] = originals;
    config.PROVIDER_ORDER.splice(0, config.PROVIDER_ORDER.length, ...order);
  }
});

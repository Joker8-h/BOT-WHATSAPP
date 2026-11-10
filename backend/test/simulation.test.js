const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreScenario } = require('../scripts/simulateSale');

test('el evaluador de cambio de ciudad no exige un pedido ni datos no suministrados', () => {
  const checks = scoreScenario({ turns: ['Bogotá', 'Popayán calle 5 #12-34'], expect: { close: 'none', city: 'Popayán' } }, { city: 'Popayán', address: 'calle 5 #12-34' }, {}, {});
  assert.ok(checks.every(([, ok]) => ok), JSON.stringify(checks));
});

test('el evaluador suma unidades de productos distintos y detecta unidades perdidas', () => {
  const scenario = { turns: ['quiero dos productos'], expect: { close: 'wompi', qty: 2 } };
  const contact = { name: 'Prueba', city: 'Cali', address: 'calle 5', deliveryPhone: '3150001122' };
  const actions = { shouldCloseSale: true, productsToSell: ['Lubricante caliente', 'Lubricante neutro'] };
  assert.ok(scoreScenario(scenario, contact, {}, actions).every(([, ok]) => ok));
  actions.productsToSell = ['Lubricante caliente'];
  assert.equal(scoreScenario(scenario, contact, {}, actions).find(([key]) => key === 'cantidad==2')[1], false);
});

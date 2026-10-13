/**
 * Simulador de ventas de Sofía (sin WhatsApp).
 *
 * Ejecuta conversaciones de prueba contra aiService.generateResponse usando el
 * catálogo real de la base de datos, y muestra la respuesta, el flujo detectado,
 * las etiquetas capturadas y la ficha de venta turno a turno.
 *
 * Requiere DATABASE_URL y la API key del modelo en backend/.env
 *
 * Uso:
 *   node scripts/simulateSale.js                 -> todos los escenarios
 *   node scripts/simulateSale.js vibrador caro   -> solo escenarios cuyo id contenga esos textos
 *   SIM_BRANCH_ID=3 node scripts/simulateSale.js -> fuerza una sede concreta
 *   SIM_VERBOSE=1 node scripts/simulateSale.js   -> imprime también la ficha de venta completa
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { prisma } = require('../src/config/database');
const aiService = require('../src/services/aiService');
const { mergeSaleState } = require('../src/ai/saleState');

const SCENARIOS = [
  {
    id: 'vibrador',
    title: 'Cliente que pide un vibrador directo',
    turns: [
      'Hola buenas',
      'quiero un vibrador',
      'es para mí, algo no tan caro',
      'me gusta el primero, cuánto sale el envío a Medellín?',
    ],
  },
  {
    id: 'anal',
    title: 'Principiante en anal con miedo al dolor',
    turns: [
      'hola, necesito un lubricante anal que no duela',
      'nunca lo hemos intentado, es la primera vez',
      'y qué más me recomiendas para empezar?',
    ],
  },
  {
    id: 'regalo',
    title: 'Regalo de aniversario para pareja tímida',
    turns: [
      'Hola! busco un regalo de aniversario, ella es tímida',
      'tengo como 100 mil',
      'me gusta la idea, llega discreto el paquete?',
    ],
  },
  {
    id: 'caro',
    title: 'Objeción de precio',
    turns: [
      'hola, qué succionadores tienen?',
      'uy está muy caro',
      'no sé, déjame ver',
    ],
  },
  {
    id: 'pensarlo',
    title: 'Cliente que lo va a pensar',
    turns: [
      'buenas, quiero algo para mejorar la intimidad con mi esposo',
      'suena bien pero lo voy a pensar',
    ],
  },
  {
    id: 'morboso',
    title: 'Cliente morboso (debe redirigir a la venta con elegancia)',
    turns: [
      'hola mamacita, tú qué usas?',
      'mándame una foto tuya jaja',
      'bueno ya, qué me recomiendas para durar más?',
    ],
  },
  // ── Bloque CIERRE (pruebas 7/7 excelencia) ──
  {
    id: 'cierre-cod',
    title: 'Cierre COD completo en 1 mensaje (Popayán)',
    turns: [
      'hola, quiero un vibrador',
      'me gusta, lo llevo. Soy Carlos Ruiz, vivo en Popayán, calle 5 # 12-34 barrio Modelo, mi número es 3150001122, pago contraentrega',
    ],
    expect: { close: 'contra', city: 'Popayán' },
  },
  {
    id: 'cierre-wompi',
    title: 'Cierre Wompi en ciudad no-COD (Bogotá)',
    turns: [
      'hola, quiero un lubricante',
      'lo llevo. Soy Ana Gómez, Bogotá, carrera 10 # 4-50 apartamento 201, 3201112233, pago con Nequi',
    ],
    expect: { close: 'wompi', city: 'Bogotá' },
  },
  {
    id: 'correccion-ciudad',
    title: 'Corrección de ciudad (Bogotá → Popayán)',
    turns: [
      'quiero un vibrador, vivo en Bogotá',
      'no perdón, vivo en Popayán, calle 5 # 12-34',
    ],
    expect: { close: 'none', city: 'Popayán' },
  },
  {
    id: 'cantidad-prosa',
    title: 'Cantidad en prosa (dos unidades)',
    turns: [
      'hola, quiero dos lubricantes íntimos',
      'sí, los dos, soy María, Cali, avenida 6 # 20-30, 3182223344, pago online',
    ],
    expect: { close: 'wompi', qty: 2 },
  },
  {
    id: 'nequi-cod',
    title: 'Nequi en ciudad COD (debe ir a Wompi, no contraentrega)',
    turns: [
      'quiero un vibrador, soy de Popayán',
      'lo pago por Nequi, mi dirección es calle 5 # 12-34, 3150001122, soy Pedro',
    ],
    expect: { close: 'wompi', city: 'Popayán' },
  },
];

const COLORS = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', red: '\x1b[31m',
};
const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

function summarizeActions(actions = {}) {
  const parts = [];
  if (actions.capturedIntent) parts.push(`intención=${actions.capturedIntent}`);
  if (actions.capturedBudget) parts.push(`presupuesto=${actions.capturedBudget}`);
  if (actions.interestProducts?.length) parts.push(`interés=[${actions.interestProducts.join(', ')}]`);
  if (actions.objections?.length) parts.push(`objeción=[${actions.objections.join(', ')}]`);
  if (actions.complementsOffered?.length) parts.push(`complementos=[${actions.complementsOffered.join(', ')}]`);
  if (actions.images?.length) parts.push(`imágenes=[${actions.images.join(', ')}]`);
  if (actions.productsToSell?.length) parts.push(`vender=[${actions.productsToSell.map(p => p.name || p).join(', ')}]`);
  if (actions.shouldCreateContraEntrega) parts.push('CONTRAENTREGA');
  if (actions.shouldCloseSale) parts.push('CERRAR_VENTA(Wompi)');
  if (actions.capturedName || actions.capturedFullName) parts.push(`nombre=${actions.capturedFullName || actions.capturedName}`);
  if (actions.capturedCity) parts.push(`ciudad=${actions.capturedCity}`);
  if (actions.capturedAddress) parts.push(`dir=${actions.capturedAddress}`);
  if (actions.capturedNeighborhood) parts.push(`barrio=${actions.capturedNeighborhood}`);
  if (actions.capturedDeliveryPhone) parts.push(`tel=${actions.capturedDeliveryPhone}`);
  if (actions.capturedPaymentMethod) parts.push(`pago=${actions.capturedPaymentMethod}`);
  if (actions.shouldEscalate) parts.push('ESCALAR');
  return parts.length ? parts.join(' | ') : '(sin etiquetas)';
}

// Datos 7/7 capturados al final del escenario (para la hoja de resultados)
function scoreScenario(scenario, contact, sale, lastActions) {
  const checks = [];
  const has = (v) => v && v !== 'Sin nombre' && v !== 'Por confirmar' && String(v).trim() !== '';
  checks.push(['producto', (sale.interestProducts || lastActions.productsToSell || []).length > 0]);
  checks.push(['nombre', has(contact.name)]);
  checks.push(['ciudad', has(contact.city)]);
  checks.push(['dirección', has(contact.address)]);
  checks.push(['barrio', has(contact.neighborhood)]);
  checks.push(['teléfono', has(contact.deliveryPhone)]);
  checks.push(['cierre', !!(lastActions.shouldCreateContraEntrega || lastActions.shouldCloseSale)]);
  if (scenario.expect?.close === 'contra') checks.push(['cierre==CONTRA', !!lastActions.shouldCreateContraEntrega]);
  if (scenario.expect?.close === 'wompi') checks.push(['cierre==WOMPI', !!lastActions.shouldCloseSale]);
  if (scenario.expect?.city) checks.push([`ciudad==${scenario.expect.city}`, (contact.city || '').toLowerCase().includes(scenario.expect.city.toLowerCase().slice(0, 5))]);
  return checks;
}

async function resolveBranchId() {
  if (process.env.SIM_BRANCH_ID) return Number(process.env.SIM_BRANCH_ID);
  const branch = await prisma.branch.findFirst({
    where: { isAuthorized: true, isActive: true },
    orderBy: { id: 'asc' },
  });
  return branch?.id || null;
}

async function runScenario(scenario, branchId) {
  console.log('\n' + c('bold', '═'.repeat(70)));
  console.log(c('bold', `🎬 ${scenario.title}`) + c('dim', `  [${scenario.id}]`));
  console.log(c('bold', '═'.repeat(70)));

  const contact = {
    phone: `sim-${scenario.id}`,
    name: null,
    city: null,
    address: null,
    neighborhood: null,
    deliveryPhone: null,
    clientType: 'NUEVO',
    purchaseStage: 'CURIOSO',
    totalPurchases: 0,
    totalSpent: 0,
    branchId,
  };
  const conversation = { id: null, context: {} };
  const history = [];
  let totalTokens = 0;
  let lastActions = {};

  for (const userMessage of scenario.turns) {
    console.log(`\n${c('cyan', '👤 Cliente:')} ${userMessage}`);

    const started = Date.now();
    const result = await aiService.generateResponse(
      userMessage, contact, history, branchId, false, null, { conversation }
    );
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    totalTokens += result.tokensUsed || 0;

    console.log(`${c('green', '💬 Sofía:')} ${result.response}`);
    console.log(c('dim', `   ↳ flujo=${result.flow} · ${result.tokensUsed || 0} tokens · ${elapsed}s`));
    console.log(c('yellow', `   ↳ ${summarizeActions(result.actions)}`));

    if (result.classification) {
      contact.clientType = result.classification.clientType || contact.clientType;
      contact.purchaseStage = result.classification.purchaseStage || contact.purchaseStage;
      console.log(c('magenta', `   ↳ clasificación: ${contact.clientType} / ${contact.purchaseStage}`));
    }
    if (result.actions?.capturedName) contact.name = result.actions.capturedName;
    if (result.actions?.capturedFullName) contact.name = result.actions.capturedFullName;
    if (result.actions?.capturedCity) contact.city = result.actions.capturedCity;
    if (result.actions?.capturedAddress) contact.address = result.actions.capturedAddress;
    if (result.actions?.capturedNeighborhood) contact.neighborhood = result.actions.capturedNeighborhood;
    if (result.actions?.capturedDeliveryPhone) contact.deliveryPhone = result.actions.capturedDeliveryPhone;
    lastActions = result.actions || {};

    const merged = mergeSaleState(conversation.context.sale, result.actions, result.flow);
    if (merged) conversation.context.sale = merged;

    if (process.env.SIM_VERBOSE && conversation.context.sale) {
      console.log(c('dim', `   ↳ ficha: ${JSON.stringify(conversation.context.sale)}`));
    }

    history.push({ role: 'USER', content: userMessage, branchId });
    history.push({ role: 'ASSISTANT', content: result.response, branchId });
  }

  const sale = conversation.context.sale || {};
  console.log(c('dim', `\n   Resumen: etapa=${sale.stage || '-'} · intención=${sale.intent || '-'} · ` +
    `interés=${(sale.interestProducts || []).join(', ') || '-'} · tokens totales=${totalTokens}`));
  const checks = scoreScenario(scenario, contact, sale, lastActions);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(c(passed === checks.length ? 'green' : 'yellow',
    `   ✔ Datos 7/7 + expectativas: ${passed}/${checks.length} ` +
    checks.map(([k, ok]) => `${ok ? '✓' : '✗'}${k}`).join(' ')));
  return { id: scenario.id, passed, total: checks.length, checks };
}

async function main() {
  const filters = process.argv.slice(2).map(f => f.toLowerCase());
  const scenarios = filters.length
    ? SCENARIOS.filter(s => filters.some(f => s.id.includes(f)))
    : SCENARIOS;

  if (!scenarios.length) {
    console.log(`No hay escenarios que coincidan. Disponibles: ${SCENARIOS.map(s => s.id).join(', ')}`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.log(c('red', '❌ Falta DATABASE_URL en backend/.env (el simulador usa el catálogo real).'));
    return;
  }

  const branchId = await resolveBranchId();
  if (!branchId) {
    console.log(c('red', '❌ No hay sedes autorizadas/activas. Define SIM_BRANCH_ID o revisa la base de datos.'));
    return;
  }
  console.log(c('dim', `Usando sede ${branchId} · ${scenarios.length} escenario(s)`));

  const results = [];
  for (const scenario of scenarios) {
    try {
      results.push(await runScenario(scenario, branchId));
    } catch (err) {
      console.log(c('red', `❌ Error en escenario ${scenario.id}: ${err.message}`));
      results.push({ id: scenario.id, passed: 0, total: 0, error: err.message });
    }
  }

  console.log('\n' + c('bold', '═'.repeat(70)));
  console.log(c('bold', '📊 TABLA FINAL'));
  for (const r of results) {
    console.log(`  ${r.passed === r.total && r.total ? '✅' : '⚠️'} ${r.id}: ${r.passed}/${r.total}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
}

main()
  .catch(err => {
    console.error(c('red', `❌ ${err.message}`));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

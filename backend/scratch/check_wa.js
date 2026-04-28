const whatsappService = require('../src/services/whatsappService');
const logger = require('../src/utils/logger');

async function checkStatus() {
  console.log('--- WHATSAPP STATUS ---');
  const statuses = whatsappService.getAllStatuses();
  console.log(JSON.stringify(statuses, null, 2));
  process.exit(0);
}

checkStatus();

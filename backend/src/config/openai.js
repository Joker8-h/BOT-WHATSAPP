// ─────────────────────────────────────────────────────────
//  CONFIG: OpenAI Client
// ─────────────────────────────────────────────────────────
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

module.exports = { openai, MODEL };

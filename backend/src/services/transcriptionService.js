// ─────────────────────────────────────────────────────────
//  SERVICE: Transcripción de notas de voz (OpenAI Whisper)
// ─────────────────────────────────────────────────────────
const OpenAI = require('openai');
const { toFile } = require('openai');
const logger = require('../utils/logger');

const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // límite de la API: 25 MB

class TranscriptionService {
  constructor() {
    this.client = this._buildClient();
    this.groqClient = this._buildGroqClient();
    this.model = process.env.TRANSCRIPTION_MODEL || 'whisper-1';
    this.groqModel = process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo';
    if (!this.client && !this.groqClient) {
      logger.warn('⚠️ [VOICE] Transcripción deshabilitada: se necesita OPENAI_API_KEY/OPENAI_TRANSCRIPTION_API_KEY directa o GROQ_API_KEY.');
    } else if (!this.client && this.groqClient) {
      logger.info('🎙️ [VOICE] Transcripción por Groq (OpenAI no disponible).');
    }
  }

  /**
   * Whisper solo existe en la API directa de OpenAI. Si el chat corre por
   * OpenRouter, se usa un cliente aparte apuntando a api.openai.com.
   */
  _buildClient() {
    const dedicatedKey = process.env.OPENAI_TRANSCRIPTION_API_KEY;
    if (dedicatedKey) return new OpenAI({ apiKey: dedicatedKey, timeout: 60000, maxRetries: 1 });

    const key = process.env.OPENAI_API_KEY;
    if (!key || key.startsWith('sk-or-')) return null;

    const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL;
    const usesOpenRouter = baseURL && /openrouter/i.test(baseURL);
    return new OpenAI({
      apiKey: key,
      ...(baseURL && !usesOpenRouter ? { baseURL } : {}),
      timeout: 60000,
      maxRetries: 1,
    });
  }

  isAvailable() {
    return !!(this.client || this.groqClient);
  }

  /**
   * Cliente Groq OpenAI-compatible para transcribir si OpenAI falla o no existe.
   */
  _buildGroqClient() {
    if (!process.env.GROQ_API_KEY) return null;
    const baseURL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
    return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL, timeout: 60000, maxRetries: 1 });
  }

  isAudio(msg, media) {
    const type = msg?.type || msg?._raw?.type;
    if (type === 'ptt' || type === 'audio') return true;
    return !!media?.mimetype?.startsWith('audio/');
  }

  _extensionFor(mimetype = '') {
    if (mimetype.includes('ogg') || mimetype.includes('opus')) return 'ogg';
    if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
    if (mimetype.includes('mp4') || mimetype.includes('m4a') || mimetype.includes('aac')) return 'm4a';
    if (mimetype.includes('wav')) return 'wav';
    if (mimetype.includes('webm')) return 'webm';
    return 'ogg';
  }

  /**
   * Transcribe un media de whatsapp-web.js ({ data: base64, mimetype }).
   * Devuelve el texto o null si no fue posible.
   */
  async transcribe(media) {
    if ((!this.client && !this.groqClient) || !media?.data) return null;
    try {
      const buffer = Buffer.from(media.data, 'base64');
      if (buffer.length > MAX_AUDIO_BYTES) {
        logger.warn(`⚠️ [VOICE] Audio demasiado grande (${Math.round(buffer.length / 1024 / 1024)} MB), no se transcribe.`);
        return null;
      }
      const mimetype = (media.mimetype || 'audio/ogg').split(';')[0].trim();
      const file = await toFile(buffer, `nota.${this._extensionFor(mimetype)}`, { type: mimetype });

      // 1. OpenAI Whisper (prompt de dominio íntimo)
      if (this.client) {
        try {
          const result = await this.client.audio.transcriptions.create({
            file,
            model: this.model,
            language: 'es',
            prompt: 'Conversación de WhatsApp en español de Colombia con una tienda de productos íntimos: lubricante, retardante, vibrador, lencería, feromonas, contraentrega, Nequi.',
          });
          const text = (result?.text || '').trim();
          if (text) {
            logger.info(`🎙️ [VOICE] Nota de voz transcrita por OpenAI (${text.length} caracteres)`);
            return text;
          }
        } catch (openaiErr) {
          logger.warn(`⚠️ [VOICE] Whisper OpenAI falló (${openaiErr.message?.substring(0, 100)}), probando Groq...`);
        }
      }

      // 2. Fallback Groq (sin prompt custom: no todos los endpoints lo aceptan)
      if (this.groqClient) {
        const result = await this.groqClient.audio.transcriptions.create({
          file,
          model: this.groqModel,
          language: 'es',
          response_format: 'json',
        });
        const text = (result?.text || '').trim();
        logger.info(`🎙️ [VOICE] Nota de voz transcrita por Groq (${text.length} caracteres)`);
        return text || null;
      }
      return null;
    } catch (error) {
      logger.error(`❌ [VOICE] Error transcribiendo nota de voz: ${error.message}`);
      return null;
    }
  }
}

module.exports = new TranscriptionService();

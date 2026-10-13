/**
 * UTILS: Encriptación para llaves sensibles
 * Usa AES-256-CBC con un secreto de sistema
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const RAW_SECRET = process.env.ENCRYPTION_KEY || 'fantasias_system_secret_key_2024';
// Deriva siempre una clave de 32 bytes (evita "Invalid key length" si ENCRYPTION_KEY no mide 32)
function _key() {
  const buf = Buffer.from(RAW_SECRET);
  if (buf.length === 32) return buf;
  return require('crypto').createHash('sha256').update(buf).digest();
}
const IV_LENGTH = 16; 

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, _key(), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return null;
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, _key(), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

module.exports = { encrypt, decrypt };

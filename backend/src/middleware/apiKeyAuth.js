const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

const validateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'API key no proporcionada. Envíala en el header X-API-Key' });
  }

  try {
    const hashed = hashApiKey(apiKey);
    const record = await prisma.apiKey.findUnique({ where: { key: hashed } });

    if (!record) {
      return res.status(401).json({ success: false, error: 'API key inválida' });
    }

    if (!record.isActive) {
      return res.status(403).json({ success: false, error: 'API key desactivada' });
    }

    // Actualizar último uso (sin await para no demorar la respuesta)
    prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {});

    req.apiKey = {
      id: record.id,
      name: record.name,
      branchId: record.branchId,
      permissions: record.permissions.split(',').map(p => p.trim())
    };

    next();
  } catch (error) {
    logger.error('Error validando API key:', error);
    return res.status(500).json({ success: false, error: 'Error interno validando autenticación' });
  }
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.apiKey || !req.apiKey.permissions.includes(permission)) {
      return res.status(403).json({ success: false, error: `Permiso requerido: ${permission}` });
    }
    next();
  };
};

module.exports = { validateApiKey, requirePermission };

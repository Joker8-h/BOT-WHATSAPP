// ─────────────────────────────────────────────────────────
//  MIDDLEWARE: Autenticación JWT & Roles (Multi-Sucursal)
// ─────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Secreto JWT de fuente única. Falla en arranque si no es seguro:
 * cualquiera con el default público del repo podría firmar tokens ADMIN.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret === 'fantasias_default_secret' || secret === 'fantasias_jwt_secret_change_me_in_production') {
    throw new Error('JWT_SECRET inválido: define uno de mínimo 32 caracteres únicos (ver backend/.env.example)');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

/**
 * Middleware de autenticación global
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token de acceso no proporcionado' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      logger.error(`Error verificando token: ${err.message}`);
      return res.status(403).json({ success: false, error: 'Token inválido o expirado' });
    }
    
    // El payload contiene { userId, username, role, branchId }
    req.user = user;
    next();
  });
};

/**
 * Middleware para restringir acceso solo a ADMINISTRADORES
 */
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Acceso restringido: requiere perfil administrador' });
  }
};

/**
 * Restringe a uno o varios roles (deny-by-default).
 * Uso: requireRole('ADMIN','MANAGER')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  return res.status(403).json({ success: false, error: 'Acceso restringido: rol insuficiente' });
};

/**
 * Middleware para asegurar que el gestor solo acceda a su propia sucursal
 * (El Admin puede acceder a todas).
 * Sin branchId explícito, los no-ADMIN quedan atados a su propia sede (req.branchId).
 */
const checkBranchAccess = (req, res, next) => {
  const requestedBranchId = parseInt(req.params.branchId || req.body.branchId || req.query.branchId);

  if (req.user.role === 'ADMIN') return next();

  if (!requestedBranchId) {
    // Sin sede pedida: forzar la propia (evita bypass en rutas :id)
    req.branchId = req.user.branchId;
    return next();
  }

  if (req.user.branchId === requestedBranchId) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'No tienes permisos para acceder a los datos de esta sucursal' });
  }
};

module.exports = {
  authenticateToken,
  isAdmin,
  requireRole,
  checkBranchAccess,
  getJwtSecret,
};

// ─────────────────────────────────────────────────────────
//  MIDDLEWARE: Autenticación JWT & Roles (Multi-Sucursal)
// ─────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'fantasias_default_secret';

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
 * Middleware para asegurar que el gestor solo acceda a su propia sucursal
 * (El Admin puede acceder a todas)
 */
const checkBranchAccess = (req, res, next) => {
  const requestedBranchId = parseInt(req.params.branchId || req.body.branchId || req.query.branchId);
  
  if (!requestedBranchId) return next();

  if (req.user.role === 'ADMIN') return next();

  if (req.user.branchId === requestedBranchId) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'No tienes permisos para acceder a los datos de esta sucursal' });
  }
};

module.exports = { 
  authenticateToken, 
  isAdmin, 
  checkBranchAccess 
};

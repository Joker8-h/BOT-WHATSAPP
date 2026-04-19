// ─────────────────────────────────────────────────────────
//  CONTROLLER: Autenticación Multi-sucursal
// ─────────────────────────────────────────────────────────
const { prisma } = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'fantasias_default_secret';

/**
 * Registro de nueva sucursal y gestor
 */
exports.register = async (req, res) => {
  const { 
    username, 
    email, 
    password, 
    branchName, 
    city, 
    address, 
    phone,
    latitude,
    longitude 
  } = req.body;

  try {
    // 1. Verificar si el usuario ya existe
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] }
    });

    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'El nombre de usuario o email ya está en uso' 
      });
    }

    // 2. Hash de contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Crear Sucursal (Pendiente de autorización)
    const branch = await prisma.branch.create({
      data: {
        name: branchName,
        city,
        address,
        phone,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        isAuthorized: false, // Requiere aprobación del Admin
      }
    });

    // 4. Crear Usuario Gestor
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: 'MANAGER',
        branchId: branch.id,
        isApproved: false, // Requiere aprobación del Admin
      }
    });

    // 5. Notificar al Admin (Simulado o vía email si está configurado)
    logger.info(`Nueva solicitud de registro: ${username} para sucursal ${branchName}`);
    
    // Enviar email de bienvenida (pendiente de aprobación)
    try {
        await emailService.sendWelcomeEmail(email, username, branchName);
    } catch (e) {
        logger.error('Error enviando email de bienvenida:', e);
    }

    res.status(201).json({ 
      success: true, 
      message: 'Registro exitoso. Tu cuenta está pendiente de aprobación por el administrador.' 
    });

  } catch (error) {
    logger.error('Error en el registro:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
};

/**
 * Login de usuario
 */
exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Buscar usuario
    const user = await prisma.user.findUnique({
      where: { username },
      include: { branch: true }
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
    }

    // 2. Verificar aprobación
    if (!user.isApproved) {
      return res.status(403).json({ 
        success: false, 
        error: 'Tu cuenta aún no ha sido aprobada por el administrador.' 
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, error: 'Tu cuenta está desactivada.' });
    }

    // 3. Verificar contraseña
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
    }

    // 4. Generar Token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role, 
        branchId: user.branchId 
      }, 
      JWT_SECRET, 
      { expiresIn: '3h' }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          branchId: user.branchId,
          branchName: user.branch?.name
        }
      }
    });

  } catch (error) {
    logger.error('Error en el login:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
};

/**
 * Obtener perfil actual
 */
exports.getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { branch: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            branchId: user.branchId,
            branch: user.branch
        }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error interno' });
  }
};

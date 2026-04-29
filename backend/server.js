// ─────────────────────────────────────────────────────────
//  🚀 FANTASÍAS CHATBOT — Servidor Principal
//  WhatsApp + OpenAI + CRM + Wompi (Multi-Sede)
//  ⚠️ Maneja dinero real — producción grade
// ─────────────────────────────────────────────────────────
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const logger = require('./src/utils/logger');
const cron = require('node-cron');
const syncService = require('./src/services/syncService');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const whatsappService = require('./src/services/whatsappService');
const messageController = require('./src/controllers/messageController');
const campaignService = require('./src/services/campaignService');
const followUpService = require('./src/services/followUpService');
const aiService = require('./src/services/aiService');
const visualService = require('./src/services/visualService');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware Global ───
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000']
    : true,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  message: { success: false, error: 'Demasiadas solicitudes, intenta más tarde' },
});
app.use('/api', apiLimiter);

// ─── Rutas API y Pagos ───
app.use('/api', apiRoutes);

// ─── Webhook de Pagos (Wompi es manejado vía apiRoutes /api/payment/wompi-webhook) ───

// ─── Health Check ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fantasias-chatbot',
    uptime: Math.floor(process.uptime()),
    whatsapp: whatsappService.getAllStatuses(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── Servir React Admin Panel (build de producción) ───
const adminBuildPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(adminBuildPath)) {
  app.use(express.static(adminBuildPath));
  // SPA fallback — todas las rutas que no son API van a React
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/health') && !req.path.startsWith('/payment')) {
      res.sendFile(path.join(adminBuildPath, 'index.html'));
    }
  });
  logger.info('📁 Sirviendo admin panel desde build de producción');
} else {
  app.get('/', (req, res) => {
    res.json({
      message: '🌟 Fantasías Chatbot API',
      admin: 'Para el panel admin, ejecuta: cd admin-panel && npm run build',
      health: '/health',
      docs: 'API disponible en /api/*',
    });
  });
}

// ─── Error Handler Global ───
app.use((err, req, res, next) => {
  logger.error('Error no manejado:', err);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
  });
});

// ─── Inicializar Todo ───
async function startServer() {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🌟 FANTASÍAS — Chatbot IA WhatsApp    ║
  ║   Motor: OpenAI GPT-4o                  ║
  ║   CRM + Wompi + Inventario              ║
  ║   ⚠️  Maneja dinero real                 ║
  ╚══════════════════════════════════════════╝
  `);

  try {
    // 1. Conectar base de datos
    logger.info('📦 Conectando a MySQL...');
    await connectDatabase();

    // 1b. Inicializar base visual (Ticket)
    const ticketBasePath = path.join(__dirname, 'data', 'ticket_base.png');
    if (fs.existsSync(ticketBasePath)) {
      await visualService.uploadBaseImage(ticketBasePath);
    } else {
      logger.warn('⚠️ No se encontró la imagen base del ticket en ./data/ticket_base.png. Saltando subida.');
    }

    // 2. Inicializar WhatsApp
    logger.info('📱 Motor WhatsApp Multi-Branch listo (se inicia bajo demanda)');
    whatsappService.onMessage(async (msg) => {
      await messageController.handleIncomingMessage(msg);
    });

    // 3. Campañas
    campaignService.setWhatsAppService(whatsappService);
    campaignService.startScheduler();

    // 3b. Follow-Up Automático (Recuperación de ventas)
    followUpService.setServices(whatsappService, aiService);

    // 4. Autostart de sesiones autorizadas (Fase 1 Estabilidad)
    whatsappService.initAllActiveSessions();

    // 5. Schedulers
    // Sincronización automática de inventario (cada 15 minutos)
    cron.schedule('*/15 * * * *', () => {
      syncService.syncAll();
    });
    // Ejecutar una vez al inicio
    syncService.syncAll();

    // Follow-up automático (cada hora, Lun-Sáb 9am-6pm Colombia)
    cron.schedule('0 9-18 * * 1-6', () => {
      followUpService.processFollowUps();
    });

    // Responder mensajes recibidos fuera de horario (9:01am, Lun-Sáb)
    cron.schedule('1 9 * * 1-6', () => {
      followUpService.processOfflineMessages();
    });

    // 5. Servidor HTTP
    app.listen(PORT, () => {
      logger.info(`🌐 Servidor: http://localhost:${PORT}`);
      logger.info(`📊 Admin Panel: http://localhost:${PORT} (o http://localhost:5173 en dev)`);
      logger.info(`❤️  Health: http://localhost:${PORT}/health`);
      console.log(`\n  ⚡ Sistema listo! Esperando mensajes de WhatsApp...\n`);
    });

  } catch (error) {
    logger.error('❌ Error iniciando servidor:', error);
    process.exit(1);
  }
}

// ─── Graceful Shutdown ───
const shutdown = async (signal) => {
  logger.info(`🛑 ${signal} recibido, cerrando...`);
  try {
    await whatsappService.destroyAll();
    await disconnectDatabase();
    logger.info('👋 Desconexión limpia completada');
  } catch (e) {
    logger.error('Error durante el cierre:', e);
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

startServer();

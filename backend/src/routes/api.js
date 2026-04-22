// ─────────────────────────────────────────────────────────
//  ROUTES: API del Admin + Pagos + Upload Excel (Multi-sucursal)
// ─────────────────────────────────────────────────────────
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminController = require('../controllers/adminController');
const authController = require('../controllers/authController');
const paymentController = require('../controllers/paymentController');
const wompiController = require('../controllers/wompiController');
const { authenticateToken, isAdmin, checkBranchAccess } = require('../middleware/auth');

const router = express.Router();

// ── Configurar Multer para Excel upload ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `catalogo_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ── Rutas Públicas (Auth y Pagos) ──
// router.post('/auth/register', authController.register); // Desactivado
router.post('/auth/login', authController.login);
router.get('/public/status', (req, res) => {
  const whatsappService = require('../services/whatsappService');
  res.json({ success: true, statuses: whatsappService.getAllStatuses() });
});
router.get('/debug/test-campaign-yopal', async (req, res) => {
  try {
    const { prisma } = require('../config/database');
    const campaignService = require('../services/campaignService');
    const whatsappService = require('../services/whatsappService');
    
    // 1. Diagnóstico de Sesión
    const status = whatsappService.getBranchStatus(2);
    const contacts = await prisma.contact.findMany({ where: { branchId: 2, isActive: true } });

    if (!status.isReady) {
      return res.json({ 
        success: false, 
        error: 'Sesión de Yopal no está READY (Conectada)', 
        status: status.status,
        whatsappStatus: status,
        contactsFound: contacts.length
      });
    }

    // 2. Crear Campaña
    const campaign = await prisma.campaign.create({
      data: {
        name: `TEST YOPAL ${new Date().toLocaleTimeString()}`,
        message: '🚀 ¡Prueba de Campaña Masiva Fantasías (Yopal)! Validando sistema multi-sede.',
        branchId: 2,
        targetFilter: { clientType: 'NUEVO' },
        status: 'RUNNING',
        totalTargets: contacts.length,
        startedAt: new Date()
      }
    });

    // 3. Disparar
    campaignService.setWhatsAppService(whatsappService);
    campaignService._sendCampaignMessages(campaign.id, contacts, campaign.message, 2);
    
    res.json({ 
      success: true, 
      message: 'Campaña Yopal disparada exitosamente', 
      campaignId: campaign.id, 
      targets: contacts.length,
      session: 'READY'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get('/payment/success', (req, res) => paymentController.paymentSuccess(req, res));
router.get('/payment/cancel', (req, res) => paymentController.paymentCancel(req, res));
router.post('/payment/wompi-webhook', (req, res) => wompiController.handleWebhook(req, res));

// ── API Admin (Protegida) ──
const api = express.Router();
api.use(authenticateToken); // Todas las rutas /api requieren JWT

// Perfil y Sesión
api.get('/auth/me', authController.getMe);

// Dashboard (Filtrado por branchId automáticamente en el controller)
api.get('/dashboard', (req, res) => adminController.getDashboard(req, res));
api.get('/dashboard/sales-today', (req, res) => adminController.getSalesToday(req, res));

// ── CRUD Sucursales (Solo Admin Root) ──
api.get('/branches', isAdmin, (req, res) => adminController.getBranches(req, res));
api.get('/branches/pending', isAdmin, (req, res) => adminController.getPendingBranches(req, res));
api.post('/branches/setup', isAdmin, (req, res) => adminController.setupNewBranch(req, res));
api.post('/branches/:id/authorize', isAdmin, (req, res) => adminController.authorizeBranch(req, res));
api.patch('/branches/:id/toggle', isAdmin, (req, res) => adminController.toggleBranchStatus(req, res));

// ── Gestión de WhatsApp (QR por sucursal) ──
api.get('/whatsapp/status', checkBranchAccess, (req, res) => adminController.getWhatsAppStatus(req, res));
api.post('/whatsapp/initialize', checkBranchAccess, (req, res) => adminController.initializeWhatsApp(req, res));
api.post('/whatsapp/logout', checkBranchAccess, (req, res) => adminController.logoutWhatsApp(req, res));

// Configuración de Wompi (Multi-sucursal)
api.get('/config/wompi', (req, res) => adminController.getWompiConfig(req, res));
api.post('/config/wompi', (req, res) => adminController.updateWompiConfig(req, res));

// ── Contactos, Productos, Pedidos ──
// (El middleware checkBranchAccess asegura que no vean data de otros)
api.get('/contacts', (req, res) => adminController.getContacts(req, res));
api.get('/products', (req, res) => adminController.getProducts(req, res));
api.post('/products', (req, res) => adminController.createProduct(req, res));
api.put('/products/:id', (req, res) => adminController.updateProduct(req, res));
api.delete('/products/:id', (req, res) => adminController.deleteProduct(req, res));

// Búsqueda Global de Inventario (Solo Admin Root)
api.get('/inventory/global-search', isAdmin, (req, res) => adminController.searchGlobalInventory(req, res));

// Upload Excel (Carga a la sucursal del usuario)
api.post('/products/upload-excel', upload.single('file'), (req, res) => adminController.uploadExcel(req, res));

// ── Sincronización Google Drive / Excel ──
api.get('/sync-sources', (req, res) => adminController.getSyncSources(req, res));
api.post('/sync-sources', (req, res) => adminController.createSyncSource(req, res));
api.delete('/sync-sources/:id', (req, res) => adminController.deleteSyncSource(req, res));
api.post('/sync-sources/:id/sync', (req, res) => adminController.triggerSync(req, res));

api.get('/orders', (req, res) => adminController.getOrders(req, res));
api.put('/orders/:id/status', (req, res) => adminController.updateOrderStatus(req, res));
api.get('/conversations', (req, res) => adminController.getConversations(req, res));
api.get('/conversations/:id/messages', (req, res) => adminController.getConversationMessages(req, res));
api.patch('/conversations/:id/status', (req, res) => adminController.toggleConversationStatus(req, res));

// ── Campaigns ──
api.get('/admin/campaigns', (req, res) => adminController.getCampaigns(req, res));
api.post('/admin/campaigns', (req, res) => adminController.createCampaign(req, res));
api.post('/admin/campaigns/:id/execute', (req, res) => adminController.executeCampaign(req, res));

// ── WhatsApp Manual ──
api.post('/admin/whatsapp/send', (req, res) => adminController.sendManualMessage(req, res));

// ── Gestión de Empleados Autorizados ──
api.use('/employees/access', require('./employeeRoutes'));

// ── Carga de Imágenes a Cloudinary ──
api.use('/upload', require('./uploadRoutes'));

// ── Métricas y Alertas ──
api.get('/dashboard/stock-alerts', (req, res) => adminController.getStockAlerts(req, res));
api.get('/metrics', (req, res) => adminController.getMetrics(req, res));

// ── Stock Specific ──
api.put('/products/:id/stock', (req, res) => adminController.updateStock(req, res));

router.use('/', api);

module.exports = router;

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
const metricsController = require('../controllers/metricsController');
const employeeController = require('../controllers/employeeController');
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

// ── Rutas Públicas (Auth y Pagos) ──
// router.post('/auth/register', authController.register); // Desactivado
router.post('/auth/login', authController.login);
// Solo estado de conexión: nunca exponer el QR ni datos de la sesión (permitiría vincular el WhatsApp).
router.get('/public/status', (req, res) => {
  const whatsappService = require('../services/whatsappService');
  res.json({ success: true, statuses: whatsappService.getPublicStatuses() });
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
api.get('/branches/:id', isAdmin, (req, res) => adminController.getBranch(req, res));
api.put('/branches/:id/settings', isAdmin, (req, res) => adminController.updateBranchSettings(req, res));
api.put('/branches/:id/schedule', isAdmin, (req, res) => adminController.updateBranchSchedule(req, res));

// ── Gestión de Admins (LIDs) por Sede ──
api.get('/branches/:id/admins', isAdmin, (req, res) => adminController.getAdminLids(req, res));
api.post('/branches/:id/admins', isAdmin, (req, res) => adminController.addAdminLid(req, res));
api.delete('/branches/:id/admins/:lid', isAdmin, (req, res) => adminController.removeAdminLid(req, res));

// ── Configuración Global del Sistema ──
api.get('/admin/settings', isAdmin, (req, res) => adminController.getSettings(req, res));
api.put('/admin/settings', isAdmin, (req, res) => adminController.updateSettings(req, res));

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

// ── Catálogo de la tienda web (fuente principal) ──
api.get('/store-catalog/status', isAdmin, (req, res) => {
  const storeCatalogService = require('../services/storeCatalogService');
  res.json({ success: true, config: storeCatalogService.config, lastResult: storeCatalogService.lastResult });
});
api.post('/store-catalog/sync', isAdmin, async (req, res) => {
  const storeCatalogService = require('../services/storeCatalogService');
  const result = await storeCatalogService.sync();
  res.json({ success: !!result, result });
});

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

// ── CRUD Empleados (Admin) ──
api.get('/employees', isAdmin, (req, res) => employeeController.list(req, res));
api.post('/employees', isAdmin, (req, res) => employeeController.create(req, res));
api.put('/employees/:id', isAdmin, (req, res) => employeeController.update(req, res));
api.delete('/employees/:id', isAdmin, (req, res) => employeeController.remove(req, res));

// ── Carga de Imágenes a Cloudinary ──
api.use('/upload', require('./uploadRoutes'));

// ── Métricas y Alertas ──
api.get('/dashboard/stock-alerts', (req, res) => adminController.getStockAlerts(req, res));
api.get('/metrics', (req, res) => adminController.getMetrics(req, res));
api.get('/metrics/dashboard', (req, res) => metricsController.getDashboardStats(req, res));
api.get('/metrics/sales-chart', (req, res) => metricsController.getSalesChart(req, res));

// ── Stock Specific ──
api.put('/products/:id/stock', (req, res) => adminController.updateStock(req, res));

router.use('/', api);

module.exports = router;

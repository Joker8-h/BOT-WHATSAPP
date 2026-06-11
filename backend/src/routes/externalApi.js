const express = require('express');
const router = express.Router();
const { validateApiKey, requirePermission } = require('../middleware/apiKeyAuth');
const externalController = require('../controllers/externalController');

// Todas las rutas requieren API key
router.use(validateApiKey);

// Productos
router.get('/products', requirePermission('products:read'), externalController.getProducts);
router.get('/products/:id', requirePermission('products:read'), externalController.getProduct);

// Stock (requiere permiso de escritura)
router.patch('/products/:id/stock', requirePermission('stock:write'), externalController.updateStock);

// Inventario
router.get('/inventory', requirePermission('products:read'), externalController.getInventorySummary);

// Sucursales
router.get('/branches', requirePermission('products:read'), externalController.getBranches);

module.exports = router;

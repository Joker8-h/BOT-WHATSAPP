const bcrypt = require('bcryptjs');
const crmService = require('../services/crmService');
const catalogService = require('../services/catalogService');
const campaignService = require('../services/campaignService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const { prisma } = require('../config/database');
const { parseExcel, mapExcelToProducts } = require('../utils/excelParser');
const logger = require('../utils/logger');
const { formatCOP } = require('../utils/helpers');
const { encrypt, decrypt } = require('../utils/encryption');

class AdminController {
  // ═══════════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════════
  async getDashboard(req, res) {
    try {
      const { role } = req.user;
      let branchId = req.user.branchId;

      // Si es Admin, puede elegir ver una sede específica vía query
      if (role === 'ADMIN' && req.query.branchId) {
        branchId = parseInt(req.query.branchId);
      }
      
      // Filtro base para las consultas
      const filter = branchId ? { branchId } : {};

      const metrics = await crmService.getMetrics(branchId);
      
      // WhatsApp Status: 
      // - Si hay branchId: estado de esa sucursal
      // - Si es Global: resumen de todas
      let waStatus;
      if (branchId) {
        waStatus = whatsappService.getBranchStatus(branchId);
      } else {
        const allStatuses = whatsappService.getAllStatuses();
        const branches = Object.keys(allStatuses);
        const onlineCount = branches.filter(id => allStatuses[id]?.isReady).length;
        waStatus = { 
          isReady: onlineCount > 0, 
          status: `${onlineCount}/${branches.length} Sedes Online` 
        };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [todaySales, todayConversations, lowStockCount] = await Promise.all([
        prisma.order.aggregate({
          where: { ...filter, status: 'PAID', createdAt: { gte: today } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.conversation.count({
          where: { ...filter, startedAt: { gte: today } },
        }),
        prisma.product.count({
          where: { ...filter, isAvailable: true, stock: { lte: 5 } },
        }),
      ]);

      res.json({
        success: true,
        data: {
          metrics,
          whatsappStatus: waStatus,
          todaySales: {
            count: todaySales._count || 0,
            amount: Number(todaySales._sum?.amount || 0),
          },
          todayConversations,
          lowStockCount,
          isGlobal: !branchId,
          branchName: branchId ? (await prisma.branch.findUnique({ where: { id: branchId } }))?.name : 'Todas las Sedes'
        },
      });
    } catch (error) {
      logger.error('Error en dashboard:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getSalesToday(req, res) {
    try {
      const { role } = req.user;
      let branchId = req.user.branchId;
      if (role === 'ADMIN' && req.query.branchId) branchId = parseInt(req.query.branchId);

      const filter = branchId ? { branchId } : {};
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sales = await prisma.order.findMany({
        where: { ...filter, status: 'PAID', createdAt: { gte: today } },
        include: {
          contact: { select: { name: true, phone: true, city: true } },
          items: { include: { product: { select: { name: true, category: true } } } },
          branch: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' },
      });

      // Resumen por producto
      const productSummary = {};
      sales.forEach(sale => {
        sale.items.forEach(item => {
          const name = item.product?.name || 'Desconocido';
          if (!productSummary[name]) {
            productSummary[name] = { name, quantity: 0, revenue: 0, category: item.product?.category };
          }
          productSummary[name].quantity += item.quantity;
          productSummary[name].revenue += Number(item.price) * item.quantity;
        });
      });

      res.json({
        success: true,
        data: {
          sales,
          summary: Object.values(productSummary),
          totalRevenue: sales.reduce((sum, s) => sum + Number(s.amount), 0),
          totalOrders: sales.length,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getStockAlerts(req, res) {
    try {
      const { role } = req.user;
      let branchId = req.user.branchId;
      if (role === 'ADMIN' && req.query.branchId) branchId = parseInt(req.query.branchId);

      const filter = branchId ? { branchId } : {};

      const products = await prisma.product.findMany({
        where: { ...filter, isAvailable: true },
        orderBy: { stock: 'asc' },
      });

      const alerts = products.filter(p => p.stock <= 10).map(p => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        category: p.category,
        branchName: p.branch?.name,
        level: p.stock === 0 ? 'AGOTADO' : p.stock <= 3 ? 'CRITICO' : 'BAJO',
      }));

      res.json({ success: true, data: alerts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  CONTACTOS
  // ═══════════════════════════════════════
  async getContacts(req, res) {
    try {
      const { page, limit, city, clientType, isActive, search } = req.query;
      const { role } = req.user;
      let branchId = req.user.branchId;
      if (role === 'ADMIN' && req.query.branchId) branchId = parseInt(req.query.branchId);

      const result = await crmService.getContacts({
        branchId,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
        city,
        clientType,
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
        search,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getContact(req, res) {
    try {
      const { branchId, role } = req.user;
      const contactId = parseInt(req.params.id);
      
      const where = { id: contactId };
      if (role === 'MANAGER') where.branchId = branchId;

      const contact = await prisma.contact.findFirst({
        where,
        include: {
          conversations: {
            orderBy: { startedAt: 'desc' },
            take: 5,
            include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } },
          },
          orders: { orderBy: { createdAt: 'desc' }, take: 10, include: { items: { include: { product: true } } } },
        },
      });
      if (!contact) return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
      res.json({ success: true, data: contact });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  PRODUCTOS — INVENTARIO PROFESIONAL
  // ═══════════════════════════════════════
  async getProducts(req, res) {
    try {
      const { category, available, search } = req.query;
      const { branchId, role } = req.user;
      
      const where = role === 'MANAGER' ? { branchId } : {};

      if (category) where.category = category;
      if (available === 'true') where.isAvailable = true;
      if (available === 'false') where.isAvailable = false;
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { description: { contains: search } },
        ];
      }

      const products = await prisma.product.findMany({
        where,
        orderBy: [{ category: 'asc' }, { isFeatured: 'desc' }, { name: 'asc' }],
        include: {
          branch: { select: { name: true, city: true } },
          _count: { select: { orderItems: true } },
        },
      });

      res.json({ success: true, data: products });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createProduct(req, res) {
    try {
      const { name, description, price, category, stock, emotionalDesc, isFeatured, imageUrl, excelRef } = req.body;

      // ── Validaciones estrictas (dinero real) ──
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Nombre del producto es requerido (mínimo 2 caracteres)' });
      }
      const numPrice = parseFloat(price);
      if (isNaN(numPrice) || numPrice <= 0) {
        return res.status(400).json({ success: false, error: 'Precio debe ser un número positivo' });
      }
      if (numPrice > 50000000) {
        return res.status(400).json({ success: false, error: 'Precio no puede exceder $50,000,000 COP' });
      }
      const numStock = parseInt(stock) || 0;
      if (numStock < 0) {
        return res.status(400).json({ success: false, error: 'Stock no puede ser negativo' });
      }
      const validCategories = ['CONEXION_PAREJA', 'EXPLORACION_SUAVE', 'SORPRESAS_DISCRETAS', 'EXPERIENCIAS_INTENSAS'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ success: false, error: 'Categoría no válida' });
      }

      const product = await prisma.product.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          price: numPrice,
          category,
          stock: numStock,
          branchId: req.user.branchId, // Forzado a sucursal del usuario
          emotionalDesc: emotionalDesc?.trim() || null,
          isFeatured: Boolean(isFeatured),
          imageUrl: imageUrl?.trim() || null,
          excelRef: excelRef?.trim() || null,
          isAvailable: true,
        },
      });

      catalogService.invalidateCache();
      logger.info(`📦 Producto creado: ${product.name} — ${formatCOP(product.price)}`);
      res.json({ success: true, data: product });
    } catch (error) {
      logger.error('Error creando producto:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateProduct(req, res) {
    try {
      const id = parseInt(req.params.id);
      const { branchId, role } = req.user;
      
      const where = { id };
      if (role === 'MANAGER') where.branchId = branchId;

      const existing = await prisma.product.findFirst({ where });
      if (!existing) {
          logger.warn(`⚠️ Intento de acceso no autorizado al producto ${id} por usuario ${req.user.username}`);
          return res.status(404).json({ success: false, error: 'Producto no encontrado en esta sucursal' });
      }

      const { name, description, price, category, stock, emotionalDesc, isFeatured, imageUrl, isAvailable } = req.body;

      // Validaciones
      if (price !== undefined) {
        const numPrice = parseFloat(price);
        if (isNaN(numPrice) || numPrice <= 0 || numPrice > 50000000) {
          return res.status(400).json({ success: false, error: 'Precio inválido' });
        }
      }
      if (stock !== undefined && parseInt(stock) < 0) {
        return res.status(400).json({ success: false, error: 'Stock no puede ser negativo' });
      }

      const data = {};
      if (name !== undefined) data.name = name.trim();
      if (description !== undefined) data.description = description?.trim();
      if (price !== undefined) data.price = parseFloat(price);
      if (category !== undefined) data.category = category;
      if (stock !== undefined) data.stock = parseInt(stock);
      if (emotionalDesc !== undefined) data.emotionalDesc = emotionalDesc?.trim();
      if (isFeatured !== undefined) data.isFeatured = Boolean(isFeatured);
      if (imageUrl !== undefined) data.imageUrl = imageUrl?.trim();
      if (isAvailable !== undefined) data.isAvailable = Boolean(isAvailable);

      const product = await prisma.product.update({ where: { id }, data });
      catalogService.invalidateCache();

      logger.info(`📦 Producto actualizado: ${product.name}`);
      res.json({ success: true, data: product });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async deleteProduct(req, res) {
    try {
      const id = parseInt(req.params.id);
      const { branchId, role } = req.user;

      const where = { id };
      if (role === 'MANAGER') where.branchId = branchId;

      const product = await prisma.product.findFirst({ where });
      if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado' });

      // Soft delete
      await prisma.product.update({
        where: { id },
        data: { isAvailable: false },
      });
      catalogService.invalidateCache();
      logger.info(`🗑️ Producto desactivado: ID ${id}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateStock(req, res) {
    try {
      const id = parseInt(req.params.id);
      const { branchId, role } = req.user;
      const { stock, adjustment, reason } = req.body;

      const where = { id };
      if (role === 'MANAGER') where.branchId = branchId;

      const product = await prisma.product.findFirst({ where });
      if (!product) return res.status(404).json({ success: false, error: 'Producto no encontrado' });

      let newStock;
      if (stock !== undefined) {
        // Set absoluto
        newStock = parseInt(stock);
      } else if (adjustment !== undefined) {
        // Ajuste relativo (+5, -3)
        newStock = product.stock + parseInt(adjustment);
      } else {
        return res.status(400).json({ success: false, error: 'Envía stock o adjustment' });
      }

      if (newStock < 0) {
        return res.status(400).json({ success: false, error: 'Stock no puede ser negativo' });
      }

      const updated = await prisma.product.update({
        where: { id },
        data: { stock: newStock },
      });

      catalogService.invalidateCache();
      logger.info(`📊 Stock actualizado: ${product.name} ${product.stock} → ${newStock} (${reason || 'manual'})`);
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  UPLOAD EXCEL — Importar productos
  // ═══════════════════════════════════════
  async uploadExcel(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No se envió ningún archivo' });
      }

      logger.info(`📥 Archivo Excel recibido: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

      // 1. Parsear Excel (Ahora extrae imágenes asíncronamente)
      const rawData = await parseExcel(req.file.path);
      if (rawData.length === 0) {
        return res.status(400).json({ success: false, error: 'El archivo está vacío' });
      }

      // 2. Mapear a productos
      const products = mapExcelToProducts(rawData);

      // 3. Importar a BD
      let imported = 0;
      let updated = 0;
      let errors = [];

      for (const product of products) {
        try {
          // Validar precio
          if (product.price <= 0 || product.price > 50000000) {
            errors.push(`${product.name}: precio inválido (${product.price})`);
            continue;
          }

          const result = await catalogService.upsertProduct(product);
          if (result) {
            imported++;
          }
        } catch (err) {
          errors.push(`${product.name}: ${err.message}`);
        }
      }

      catalogService.invalidateCache();

      logger.info(`📥 Excel importado: ${imported} productos, ${errors.length} errores`);

      res.json({
        success: true,
        data: {
          totalRows: rawData.length,
          imported,
          errors: errors.slice(0, 10), // Máximo 10 errores en respuesta
          columns: Object.keys(rawData[0] || {}),
        },
      });
    } catch (error) {
      logger.error('Error importando Excel:', error);
      res.status(500).json({ success: false, error: `Error procesando archivo: ${error.message}` });
    }
  }

  // ═══════════════════════════════════════
  //  PEDIDOS
  // ═══════════════════════════════════════
  async getOrders(req, res) {
    try {
      const { status, page = 1 } = req.query;
      const { role } = req.user;
      let branchId = req.user.branchId;
      if (role === 'ADMIN' && req.query.branchId) branchId = parseInt(req.query.branchId);

      const where = branchId ? { branchId } : {};
      if (status) where.status = status;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include: {
            contact: { select: { name: true, phone: true, city: true } },
            items: { include: { product: { select: { name: true, category: true, price: true } } } },
            branch: { select: { name: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip: (parseInt(page) - 1) * 30,
          take: 30,
        }),
        prisma.order.count({ where }),
      ]);

      res.json({ success: true, data: { orders, total, totalPages: Math.ceil(total / 30) } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateOrderStatus(req, res) {
    try {
      const id = parseInt(req.params.id);
      const { branchId, role } = req.user;
      const { status, trackingNumber, shippingAddress } = req.body;

      const where = { id };
      if (role === 'MANAGER') where.branchId = branchId;

      const existing = await prisma.order.findFirst({ where });
      if (!existing) return res.status(404).json({ success: false, error: 'Orden no encontrada' });

      const validStatuses = ['PENDING', 'PAYMENT_SENT', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'Estado no válido' });
      }

      const data = { status };
      if (trackingNumber) data.trackingNumber = trackingNumber;
      if (shippingAddress) data.shippingAddress = shippingAddress;

      const order = await prisma.order.update({ where: { id }, data });
      logger.info(`📋 Orden #${id} actualizada: ${status}`);
      res.json({ success: true, data: order });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  CONVERSACIONES
  // ═══════════════════════════════════════
  async getConversations(req, res) {
    try {
      const { role } = req.user;
      let branchId = req.user.branchId;
      if (role === 'ADMIN' && req.query.branchId) branchId = parseInt(req.query.branchId);

      const conversations = await crmService.getRecentConversations(50, branchId);
      res.json({ success: true, data: conversations });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getConversationMessages(req, res) {
    try {
      const messages = await prisma.message.findMany({
        where: { conversationId: parseInt(req.params.id) },
        orderBy: { createdAt: 'asc' },
      });
      res.json({ success: true, data: messages });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  CAMPAÑAS
  // ═══════════════════════════════════════
  async getCampaigns(req, res) {
    try {
      const campaigns = await campaignService.getCampaigns();
      res.json({ success: true, data: campaigns });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createCampaign(req, res) {
    try {
      const campaign = await campaignService.createCampaign(req.body);
      res.json({ success: true, data: campaign });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async executeCampaign(req, res) {
    try {
      const result = await campaignService.executeCampaign(parseInt(req.params.id));
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  MENSAJES MANUALES
  // ═══════════════════════════════════════
  async sendManualMessage(req, res) {
    try {
      const { phone, message } = req.body;
      const { branchId } = req.user;
      if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'phone y message son requeridos' });
      }
      const chatId = phone.replace('+', '') + '@c.us';
      const sent = await whatsappService.sendMessage(branchId, chatId, message);
      res.json({ success: sent });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  MÉTRICAS
  // ═══════════════════════════════════════
  async getMetrics(req, res) {
    try {
      const { role } = req.user;
      const { audit } = req.query;
      let branchId = req.user.branchId;
      if (role === 'ADMIN' && req.query.branchId) branchId = parseInt(req.query.branchId);

      const filter = branchId ? { branchId } : {};

      // Si se solicita auditoría detallada (SaaS Master View)
      if (audit === 'true' && branchId) {
        const orders = await prisma.order.findMany({
          where: { branchId, status: 'PAID' },
          include: { 
            contact: { select: { name: true, phone: true } },
            items: true // Incluye nombre, precio, cantidad de cada producto vendido
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        });
        return res.json({ success: true, data: { orders } });
      }

      const [dailyMetrics, crmMetrics, productStats] = await Promise.all([
        prisma.dailyMetric.findMany({ 
          where: filter,
          orderBy: { date: 'desc' }, 
          take: 30 
        }),
        crmService.getMetrics(branchId),
        prisma.product.groupBy({
          by: ['category'],
          _sum: { stock: true },
          _count: true,
          where: { ...filter, isAvailable: true },
        }),
      ]);

      res.json({ success: true, data: { daily: dailyMetrics, crm: crmMetrics, productStats } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  GESTIÓN DE SUCURSALES (ADMIN ROOT — SaaS)
  // ═══════════════════════════════════════
  async setupNewBranch(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, error: 'Acceso denegado: Solo el administrador raíz puede crear sedes.' });
      }
      const { name, city, address, phone, password, latitude, longitude } = req.body;

      if (!name || !city || !address || !password) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios' });
      }

      // El usuario para la sucursal será su ubicación/ciudad como pidió el usuario
      const username = city.toLowerCase().replace(/\s+/g, '_');
      
      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await prisma.$transaction(async (tx) => {
        const branch = await tx.branch.create({
          data: {
            name,
            city,
            address,
            phone,
            latitude,
            longitude,
            isActive: true,
            isAuthorized: true
          }
        });

        const user = await tx.user.create({
          data: {
            username,
            email: `${username}@fantasias.bot`, // Generado automáticamente
            password: hashedPassword,
            role: 'MANAGER',
            branchId: branch.id,
            isApproved: true,
            isActive: true
          }
        });

        return { branch, user };
      });

      logger.info(`🏢 Nueva sucursal SaaS creada: ${name} (Usuario: ${result.user.username})`);
      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Error creando sucursal SaaS:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getBranches(req, res) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [branches, salesToday] = await Promise.all([
        prisma.branch.findMany({
          include: { 
            _count: { select: { users: true, products: true, orders: true } } 
          }
        }),
        prisma.order.groupBy({
          by: ['branchId'],
          where: { status: 'PAID', createdAt: { gte: today } },
          _sum: { amount: true },
          _count: true
        })
      ]);

      const data = branches.map(b => {
        const sales = salesToday.find(s => s.branchId === b.id);
        return {
          ...b,
          todayMetrics: {
            amount: Number(sales?._sum?.amount || 0),
            count: sales?._count || 0
          }
        };
      });

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async toggleBranchStatus(req, res) {
    try {
      const { id } = req.params;
      const bId = parseInt(id);
      const branch = await prisma.branch.findUnique({ where: { id: bId } });
      if (!branch) return res.status(404).json({ success: false, error: 'Sede no encontrada' });

      const updated = await prisma.branch.update({
        where: { id: bId },
        data: { isActive: !branch.isActive }
      });

      logger.info(`🏢 Estado de sucursal ${bId} cambiado a: ${updated.isActive ? 'ACTIVA' : 'INACTIVA'}`);
      res.json({ success: true, data: updated });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getPendingBranches(req, res) {
    try {
      const branches = await prisma.branch.findMany({
        where: { isAuthorized: false },
        include: { users: { select: { username: true, email: true } } }
      });
      res.json({ success: true, data: branches });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async authorizeBranch(req, res) {
    try {
      const id = parseInt(req.params.id);
      
      const branch = await prisma.branch.update({
        where: { id },
        data: { isAuthorized: true, isActive: true }
      });

      // Aprobar también a los usuarios asociados
      const users = await prisma.user.updateMany({
        where: { branchId: id },
        data: { isApproved: true, isActive: true }
      });

      // Notificar por email al primer usuario encontrado
      const firstUser = await prisma.user.findFirst({ where: { branchId: id } });
      if (firstUser) {
          await emailService.sendActivationEmail(firstUser.email, firstUser.username);
      }

      logger.info(`✅ Sucursal "${branch.name}" autorizada por admin.`);
      res.json({ success: true, message: 'Sucursal autorizada correctamente' });

    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  WHATSAPP SESSION CONTROL
  // ═══════════════════════════════════════
  async getWhatsAppStatus(req, res) {
    const branchId = req.user.branchId;
    res.json({ success: true, data: whatsappService.getBranchStatus(branchId) });
  }

  async initializeWhatsApp(req, res) {
    try {
      const branchId = req.user.branchId;
      
      // Validar que tenga Wompi configurado antes de permitir el canal de ventas
      const branch = await prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch?.wompiPrivateKey) {
        return res.status(400).json({ 
          success: false, 
          error: 'Seguridad: Debes configurar y guardar tus llaves de Wompi antes de activar el bot de ventas.' 
        });
      }

      await whatsappService.initializeBranch(branchId);
      res.json({ success: true, message: 'Inicialización de sesión solicitada' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async logoutWhatsApp(req, res) {
    try {
      const branchId = req.user.branchId;
      await whatsappService.destroyBranch(branchId);
      res.json({ success: true, message: 'Sesión cerrada' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  GLOBAL INVENTORY SEARCH
  // ═══════════════════════════════════════
  async searchGlobalInventory(req, res) {
    try {
      const { query } = req.query;
      const products = await prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { description: { contains: query } }
          ]
        },
        include: { branch: true },
        orderBy: { branch: { city: 'asc' } }
      });
      res.json({ success: true, data: products });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ═══════════════════════════════════════
  //  WOMPI CONFIGURATION (MULTI-TENANT)
  // ═══════════════════════════════════════
  async getWompiConfig(req, res) {
    try {
      const { branchId } = req.user;
      if (!branchId) return res.status(400).json({ success: false, error: 'Usuario sin sucursal asignada' });

      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { 
          wompiMerchantId: true, 
          wompiPublicKey: true, 
          wompiPrivateKey: true, 
          wompiIntegritySecret: true,
          notificationGroupName: true
        }
      });

      res.json({
        success: true,
        data: {
          wompiMerchantId: branch?.wompiMerchantId || '',
          wompiPublicKey: branch?.wompiPublicKey || '',
          wompiPrivateKey: branch?.wompiPrivateKey ? '••••••••••••••••' : '',
          wompiIntegritySecret: branch?.wompiIntegritySecret ? '••••••••••••••••' : '',
          notificationGroupName: branch?.notificationGroupName || '',
          isConfigured: !!branch?.wompiPrivateKey
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateWompiConfig(req, res) {
    try {
      const { branchId } = req.user;
      const { wompiMerchantId, wompiPublicKey, wompiPrivateKey, wompiIntegritySecret, notificationGroupName } = req.body;

      if (!branchId) return res.status(400).json({ success: false, error: 'Usuario sin sucursal asignada' });

      const data = {};
      if (wompiMerchantId !== undefined) data.wompiMerchantId = wompiMerchantId;
      if (wompiPublicKey !== undefined) data.wompiPublicKey = wompiPublicKey;
      if (notificationGroupName !== undefined) data.notificationGroupName = notificationGroupName;
      
      if (wompiPrivateKey && wompiPrivateKey !== '••••••••••••••••') {
          data.wompiPrivateKey = encrypt(wompiPrivateKey);
      }
      if (wompiIntegritySecret && wompiIntegritySecret !== '••••••••••••••••') {
          data.wompiIntegritySecret = encrypt(wompiIntegritySecret);
      }

      await prisma.branch.update({
        where: { id: branchId },
        data
      });

      logger.info(`💳 Configuración de Wompi actualizada para sucursal ${branchId}`);
      res.json({ success: true, message: 'Configuración guardada correctamente' });
    } catch (error) {
      logger.error('Error actualizando config Wompi:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();

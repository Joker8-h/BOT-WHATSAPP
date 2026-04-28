// ─────────────────────────────────────────────────────────
//  API Client — Comunicación con el backend (Multi-sucursal)
// ─────────────────────────────────────────────────────────

const API_BASE = '';

export function getToken() {
  return localStorage.getItem('fantasias_token');
}

export function setToken(token) {
  localStorage.setItem('fantasias_token', token);
}

export function removeToken() {
  localStorage.removeItem('fantasias_token');
}

export async function api(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  // No poner Content-Type si es FormData (para uploads)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

    // Si el token expiró o es inválido, redirigir al login
    if (res.status === 401 && !endpoint.includes('/auth/login')) {
      removeToken();
      window.location.href = '/login';
      return null;
    }

    return await res.json();
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return { success: false, error: 'Error de conexión con el servidor' };
  }
}

// ── Auth ──
export const loginUser = (username, password) => api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});

export const registerUser = (data) => api('/auth/register', {
  method: 'POST',
  body: JSON.stringify(data),
});

export const getMe = () => api('/api/auth/me');

// ── Dashboard ──
export const getDashboard = (branchId = '') => api(`/api/dashboard?branchId=${branchId}`);
export const getSalesToday = (branchId = '') => api(`/api/dashboard/sales-today?branchId=${branchId}`);

// ── Sucursales (Admin Root - SaaS) ──
export const getBranches = () => api('/api/branches');
export const getPendingBranches = () => api('/api/branches/pending');
export const authorizeBranch = (id) => api(`/api/branches/${id}/authorize`, { method: 'POST' });
export const setupNewBranch = (data) => api('/api/branches/setup', { method: 'POST', body: JSON.stringify(data) });
export const toggleBranchStatus = (id) => api(`/api/branches/${id}/toggle`, { method: 'PATCH' });

// ── WhatsApp (Per-branch) ──
export const getWhatsAppStatus = () => api('/api/whatsapp/status');
export const initializeWhatsApp = () => api('/api/whatsapp/initialize', { method: 'POST' });
export const logoutWhatsApp = () => api('/api/whatsapp/logout', { method: 'POST' });
export const sendManualMessage = (data) => api('/api/admin/whatsapp/send', { method: 'POST', body: JSON.stringify(data) });

// Wompi Config
export const getWompiConfig = () => api('/api/config/wompi');
export const updateWompiConfig = (data) => api('/api/config/wompi', {
  method: 'POST',
  body: JSON.stringify(data),
});

// ── Products ──
export const getProducts = (params = '') => api(`/api/products?${params}`);
export const createProduct = (data) => api('/api/products', { method: 'POST', body: JSON.stringify(data) });
export const updateProduct = (id, data) => api(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const updateStock = (id, data) => api(`/api/products/${id}/stock`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProduct = (id) => api(`/api/products/${id}`, { method: 'DELETE' });

// Búsqueda Global de Inventario (Admin Root)
export const searchGlobalInventory = (query) => api(`/api/inventory/global-search?query=${query}`);

// Upload Excel (Se asocia a la branch del usuario logueado en el backend)
export async function uploadExcel(file) {
  const formData = new FormData();
  formData.append('file', file);
  return api('/api/products/upload-excel', { method: 'POST', body: formData });
}

// ── Sincronización Google Drive / Excel ──
export const getSyncSources = () => api('/api/sync-sources');
export const createSyncSource = (data) => api('/api/sync-sources', { method: 'POST', body: JSON.stringify(data) });
export const deleteSyncSource = (id) => api(`/api/sync-sources/${id}`, { method: 'DELETE' });
export const triggerSync = (id) => api(`/api/sync-sources/${id}/sync`, { method: 'POST' });

// ── Contacts ──
export const getContacts = (params = '') => api(`/api/contacts?${params}`);
export const getContact = (id) => api(`/api/contacts/${id}`);

// ── Conversations ──
export const getConversations = () => api('/api/conversations');
export const getConversationMessages = (id) => api(`/api/conversations/${id}/messages`);
export const updateConversationStatus = (id, status) => api(`/api/conversations/${id}/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status }),
});

// ── Orders ──
export const getOrders = (params = '') => api(`/api/orders?${params}`);
export const updateOrderStatus = (id, data) => api(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify(data) });

// ── Campaigns ──
export const getCampaigns = () => api('/api/admin/campaigns');
export const createCampaign = (data) => api('/api/admin/campaigns', { method: 'POST', body: JSON.stringify(data) });
export const executeCampaign = (id) => api(`/api/admin/campaigns/${id}/execute`, { method: 'POST' });

// ── Gestión de Empleados Autorizados ──
export const getEmployees = () => api('/api/employees/access');
export const addEmployee = (data) => api('/api/employees/access', { method: 'POST', body: JSON.stringify(data) });
export const deleteEmployee = (id) => api(`/api/employees/access/${id}`, { method: 'DELETE' });

// ── Carga de Imágenes a Cloudinary ──
export async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  return api('/api/upload/image', { method: 'POST', body: formData });
}

// ── Metrics & Dashboard Helpers ──
export const getStockAlerts = (branchId = '') => api(`/api/dashboard/stock-alerts?branchId=${branchId}`);
export const getMetrics = (branchId = '') => api(`/api/metrics?branchId=${branchId}`);

// ── Formatters & Constants ──
export function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function timeAgo(date) {
  if (!date) return '—';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return `hace ${Math.floor(interval)} años`;
  interval = seconds / 2592000;
  if (interval > 1) return `hace ${Math.floor(interval)} meses`;
  interval = seconds / 86400;
  if (interval > 1) return `hace ${Math.floor(interval)} días`;
  interval = seconds / 3600;
  if (interval > 1) return `hace ${Math.floor(interval)} horas`;
  interval = seconds / 60;
  if (interval > 1) return `hace ${Math.floor(interval)} min`;
  return 'hace unos segundos';
}

export const CATEGORIES = {
  CONEXION_PAREJA: 'Conexión en pareja',
  EXPLORACION_SUAVE: 'Exploración suave',
  SORPRESAS_DISCRETAS: 'Sorpresas discretas',
  EXPERIENCIAS_INTENSAS: 'Experiencias intensas',
};

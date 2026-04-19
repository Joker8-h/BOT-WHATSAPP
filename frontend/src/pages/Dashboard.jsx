import { useState, useEffect, useCallback } from 'react';
import { getDashboard, getSalesToday, getStockAlerts, getBranches, formatCOP, timeAgo } from '../api';
import { IconWifi, IconContacts, IconChat, IconDollar, IconShoppingCart, IconAlertTriangle, IconClipboard, IconCheck } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [sales, setSales] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadBranches = useCallback(async () => {
    if (isAdmin) {
      const res = await getBranches();
      if (res?.success) setBranches(res.data);
    }
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, s, a] = await Promise.all([
      getDashboard(selectedBranch), 
      getSalesToday(selectedBranch), 
      getStockAlerts(selectedBranch)
    ]);
    if (d?.success) setData(d.data);
    if (s?.success) setSales(s.data);
    if (a?.success) setAlerts(a.data);
    setLoading(false);
  }, [selectedBranch]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // 30s para no saturar
    return () => clearInterval(interval);
  }, [load]);

  if (!data && loading) return <div className="loading">Cargando dashboard...</div>;

  const { metrics, whatsappStatus, todaySales, todayConversations, lowStockCount, branchName } = data || {};

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Resumen operativo: <strong>{branchName}</strong></p>
        </div>
        
        {isAdmin && (
          <div className="branch-selector-wrap">
            <label style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-3)', textTransform: 'uppercase', display: 'block', marginBottom: '0.4rem' }}>
              Filtrar por Sede
            </label>
            <select 
              className="filter-select"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              style={{ minWidth: '220px' }}
            >
              <option value="">Vista Global (Todas)</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.city})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="metrics-grid">
        <div className="metric-card accent-purple">
          <div className="metric-icon-wrap"><IconWifi /></div>
          <div>
            <div className="metric-value">{whatsappStatus?.isReady ? 'Conectado' : 'Desconectado'}</div>
            <div className="metric-label">WhatsApp</div>
          </div>
        </div>
        <div className="metric-card accent-green">
          <div className="metric-icon-wrap"><IconContacts /></div>
          <div>
            <div className="metric-value">{(metrics?.activeContacts || 0).toLocaleString()}</div>
            <div className="metric-label">Contactos Activos</div>
          </div>
        </div>
        <div className="metric-card accent-blue">
          <div className="metric-icon-wrap"><IconChat /></div>
          <div>
            <div className="metric-value">{todayConversations || 0}</div>
            <div className="metric-label">Chats Hoy</div>
          </div>
        </div>
        <div className="metric-card accent-gold">
          <div className="metric-icon-wrap"><IconDollar /></div>
          <div>
            <div className="metric-value">{formatCOP(todaySales?.amount)}</div>
            <div className="metric-label">Ventas Hoy ({todaySales?.count || 0})</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3 className="card-title"><IconShoppingCart /> Ventas de Hoy</h3>
          <div className="card-body">
            {sales?.summary?.length > 0 ? (
              <div className="sales-summary">
                <div className="sales-total">
                  <span className="total-amount">{formatCOP(sales.totalRevenue)}</span>
                  <span className="total-count">{sales.totalOrders} pedidos</span>
                </div>
                <table className="mini-table">
                  <thead><tr><th>Producto</th><th>Cant.</th><th>Ingreso</th></tr></thead>
                  <tbody>
                    {sales.summary.map((p, i) => (
                      <tr key={i}>
                        <td>{p.name}</td>
                        <td className="center">{p.quantity}</td>
                        <td className="right">{formatCOP(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">No hay ventas registradas hoy</p>
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">
            <IconAlertTriangle /> Alertas de Inventario
            {lowStockCount > 0 && <span className="badge-red-inline">{lowStockCount}</span>}
          </h3>
          <div className="card-body">
            {alerts.length > 0 ? (
              <div className="alert-list">
                {alerts.map(a => (
                  <div key={a.id} className={`stock-alert level-${a.level.toLowerCase()}`}>
                    <div>
                      <strong>{a.name}</strong>
                      <span className="alert-category">{a.category}</span>
                    </div>
                    <div className="alert-stock">
                      <span className={`stock-badge ${a.level.toLowerCase()}`}>
                        {a.level === 'AGOTADO' ? 'AGOTADO' : `${a.stock} uds`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty"><IconCheck /> Inventario en orden</p>
            )}
          </div>
        </div>

        <div className="card full-width">
          <h3 className="card-title"><IconClipboard /> Últimas Transacciones</h3>
          <div className="card-body">
            {sales?.sales?.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Producto</th>
                    <th>Ciudad</th>
                    <th>Monto</th>
                    <th>Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.sales.slice(0, 10).map(s => (
                    <tr key={s.id}>
                      <td>{s.contact?.name || s.contact?.phone || '—'}</td>
                      <td>{s.items?.map(i => i.product?.name).join(', ') || '—'}</td>
                      <td>{s.contact?.city || '—'}</td>
                      <td className="money">{formatCOP(s.amount)}</td>
                      <td className="muted">{timeAgo(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">Las transacciones del día aparecerán aquí</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

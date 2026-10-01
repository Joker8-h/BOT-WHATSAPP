import { useState, useEffect } from 'react';
import { getOrders, updateOrderStatus, downloadOrdersCSV, formatCOP, formatDate } from '../api';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    const r = await getOrders(params.toString());
    if (r?.success) setOrders(r.data.orders);
  };

  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => { const i = setInterval(load, 20000); return () => clearInterval(i); }, [statusFilter]);

  const changeStatus = async (id, status) => {
    let trackingNumber = undefined;
    if (status === 'SHIPPED') {
      const guide = window.prompt('Ingresa el número de guía de la transportadora (opcional):');
      if (guide !== null && guide.trim() !== '') {
        trackingNumber = guide.trim();
      }
    }
    await updateOrderStatus(id, { status, ...(trackingNumber ? { trackingNumber } : {}) });
    load();
  };

  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      await downloadOrdersCSV(params.toString());
    } catch (err) {
      alert('Error al descargar el reporte CSV: ' + (err.message || 'Error desconocido'));
    } finally {
      setExporting(false);
    }
  };

  const statusColors = {
    PENDING: 'orange', PAYMENT_SENT: 'blue', PAID: 'green',
    SHIPPED: 'purple', DELIVERED: 'emerald', CANCELLED: 'red', REFUNDED: 'red',
  };

  const statusLabels = {
    PENDING: 'Pendiente', PAYMENT_SENT: 'Pago Enviado', PAID: 'Pagado',
    SHIPPED: 'Enviado', DELIVERED: 'Entregado', CANCELLED: 'Cancelado', REFUNDED: 'Reembolsado',
  };

  const totalPaid = orders.filter(o => o.status === 'PAID').reduce((s, o) => s + Number(o.amount), 0);

  return (
    <div>
      <h1 className="page-title">Pedidos</h1>
      <p className="page-subtitle">Historial de compras, despachos y pagos</p>

      <div className="mini-metrics">
        <div className="mini-metric accent-green"><span className="mm-value">{orders.filter(o => o.status === 'PAID').length}</span><span className="mm-label">Pagados</span></div>
        <div className="mini-metric accent-gold"><span className="mm-value">{formatCOP(totalPaid)}</span><span className="mm-label">Total cobrado</span></div>
        <div className="mini-metric accent-blue"><span className="mm-value">{orders.filter(o => o.status === 'SHIPPED').length}</span><span className="mm-label">Enviados</span></div>
        <div className="mini-metric accent-purple"><span className="mm-value">{orders.filter(o => o.status === 'PENDING').length}</span><span className="mm-label">Pendientes</span></div>
      </div>

      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="PENDING">Pendientes</option>
            <option value="PAID">Pagados</option>
            <option value="SHIPPED">Enviados</option>
            <option value="DELIVERED">Entregados</option>
            <option value="CANCELLED">Cancelados</option>
          </select>
        </div>

        <button
          className="btn btn-secondary"
          onClick={handleExportCSV}
          disabled={exporting || orders.length === 0}
          title="Descargar reporte completo en formato Excel CSV con UTF-8"
        >
          {exporting ? '⏳ Generando CSV...' : '📥 Exportar Pedidos a CSV'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Cliente & Teléfono</th>
              <th>Dirección & Ciudad</th>
              <th>Producto(s)</th>
              <th>Método & Guía</th>
              <th>Monto</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              const deliveryPhone = o.contact?.deliveryPhone && o.contact.deliveryPhone !== o.contact.phone
                ? o.contact.deliveryPhone
                : null;
              const addr = o.shippingAddress || o.contact?.address || '—';
              const neighborhood = o.contact?.neighborhood ? ` (${o.contact.neighborhood})` : '';
              const city = o.shippingCity || o.contact?.city || '—';

              return (
                <tr key={o.id}>
                  <td className="mono">#{o.id}</td>
                  <td>
                    <strong>{o.contact?.name || '—'}</strong>
                    <br />
                    <span className="muted">📞 {o.contact?.phone}</span>
                    {deliveryPhone && (
                      <span className="muted" style={{ display: 'block', fontSize: '0.8em', color: '#6366f1' }}>
                        🚚 Entrega: {deliveryPhone}
                      </span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{addr}{neighborhood}</span>
                    <br />
                    <span className="muted">📍 {city}</span>
                  </td>
                  <td>{o.items?.map(i => `${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.product?.name || 'Producto'}`).join(', ') || '—'}</td>
                  <td>
                    <span className="badge badge-subtle" style={{ fontSize: '0.75rem' }}>
                      {o.paymentMethod || 'CONTRAENTREGA'}
                    </span>
                    {o.trackingNumber && (
                      <div style={{ marginTop: '4px', fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>
                        🏷️ {o.trackingNumber}
                      </div>
                    )}
                  </td>
                  <td className="money">{formatCOP(o.amount)}</td>
                  <td><span className={`badge badge-${statusColors[o.status] || 'muted'}`}>{statusLabels[o.status] || o.status}</span></td>
                  <td className="muted">{formatDate(o.createdAt)}</td>
                  <td>
                    <select className="mini-select" value={o.status}
                      onChange={e => changeStatus(o.id, e.target.value)}>
                      <option value="PENDING">Pendiente</option>
                      <option value="PAID">Pagado</option>
                      <option value="SHIPPED">Enviado</option>
                      <option value="DELIVERED">Entregado</option>
                      <option value="CANCELLED">Cancelado</option>
                      <option value="REFUNDED">Reembolsado</option>
                    </select>
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && <tr><td colSpan={9} className="empty">No hay pedidos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

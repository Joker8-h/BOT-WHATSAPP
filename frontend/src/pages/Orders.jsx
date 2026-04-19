import { useState, useEffect } from 'react';
import { getOrders, updateOrderStatus, formatCOP, formatDate } from '../api';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    const r = await getOrders(params.toString());
    if (r?.success) setOrders(r.data.orders);
  };

  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => { const i = setInterval(load, 20000); return () => clearInterval(i); }, [statusFilter]);

  const changeStatus = async (id, status) => {
    await updateOrderStatus(id, { status });
    load();
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
      <p className="page-subtitle">Historial de compras y pagos</p>

      <div className="mini-metrics">
        <div className="mini-metric accent-green"><span className="mm-value">{orders.filter(o => o.status === 'PAID').length}</span><span className="mm-label">Pagados</span></div>
        <div className="mini-metric accent-gold"><span className="mm-value">{formatCOP(totalPaid)}</span><span className="mm-label">Total cobrado</span></div>
        <div className="mini-metric accent-blue"><span className="mm-value">{orders.filter(o => o.status === 'SHIPPED').length}</span><span className="mm-label">Enviados</span></div>
        <div className="mini-metric accent-purple"><span className="mm-value">{orders.filter(o => o.status === 'PENDING').length}</span><span className="mm-label">Pendientes</span></div>
      </div>

      <div className="toolbar">
        <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Todos</option>
          <option value="PENDING">Pendientes</option>
          <option value="PAID">Pagados</option>
          <option value="SHIPPED">Enviados</option>
          <option value="DELIVERED">Entregados</option>
          <option value="CANCELLED">Cancelados</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Cliente</th>
              <th>Producto(s)</th>
              <th>Ciudad</th>
              <th>Monto</th>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="mono">#{o.id}</td>
                <td><strong>{o.contact?.name || '—'}</strong><br /><span className="muted">{o.contact?.phone}</span></td>
                <td>{o.items?.map(i => i.product?.name).join(', ') || '—'}</td>
                <td>{o.contact?.city || '—'}</td>
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
            ))}
            {orders.length === 0 && <tr><td colSpan={8} className="empty">No hay pedidos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

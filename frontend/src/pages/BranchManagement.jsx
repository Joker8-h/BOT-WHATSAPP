import { useState, useEffect } from 'react';
import { getBranches, setupNewBranch, formatCOP, formatDate, getMetrics, toggleBranchStatus } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  IconMap, IconPhone, IconDollar, IconShoppingCart, IconAlertTriangle, 
  IconCheck, IconSettings, IconShield, IconClipboard, IconUser, IconClock 
} from '../components/Icons';
import Swal from 'sweetalert2';

export default function BranchManagement() {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', address: '', phone: '', password: '' });
  const [creating, setCreating] = useState(false);

  // Estados para Auditoría Detallada
  const [showAudit, setShowAudit] = useState(false);
  const [auditData, setAuditData] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);

  useEffect(() => {
    loadBranches();
  }, []);

  const loadBranches = async () => {
    setLoading(true);
    const res = await getBranches();
    if (res?.success) setBranches(res.data);
    setLoading(false);
  };

  const handleToggleStatus = async (branch) => {
    const action = branch.isActive ? 'desactivar' : 'activar';
    const result = await Swal.fire({
      title: `¿${action.charAt(0).toUpperCase() + action.slice(1)} sede?`,
      text: branch.isActive 
        ? 'La sede dejará de operar y el bot de WhatsApp se detendrá para esta sucursal.' 
        : 'La sede volverá a estar operativa y podrá procesar ventas.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: branch.isActive ? 'var(--red)' : 'var(--green)',
      cancelButtonColor: 'var(--text-3)',
      confirmButtonText: `Sí, ${action}`,
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    const res = await toggleBranchStatus(branch.id);
    if (res?.success) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Sede ${action === 'activar' ? 'activada' : 'desactivada'}`,
        showConfirmButton: false,
        timer: 2000
      });
      loadBranches();
    } else {
      Swal.fire('Error', res?.error || 'No se pudo cambiar el estado', 'error');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    const res = await setupNewBranch(form);
    setCreating(false);
    
    if (res?.success) {
      Swal.fire({
        title: '¡Sede Activada!',
        html: `<p>Sucursal creada con éxito.</p><p style="font-size: 0.8rem; margin-top: 10px;">Usuario: <strong>${res.data.user.username}</strong></p>`,
        icon: 'success',
        confirmButtonColor: 'var(--purple)',
        borderRadius: '16px'
      });
      setShowModal(false);
      setForm({ name: '', city: '', address: '', phone: '', password: '' });
      loadBranches();
    } else {
      Swal.fire('Error', res?.error || 'No se pudo crear la sucursal', 'error');
    }
  };

  const openAudit = async (branch) => {
    setSelectedBranch(branch);
    setShowAudit(true);
    setLoadingAudit(true);
    const res = await getMetrics(branch.id + '&audit=true');
    if (res?.success) {
      setAuditData(res.data.orders || []);
    } else {
      Swal.fire('Error', 'No se pudo cargar la auditoría', 'error');
    }
    setLoadingAudit(false);
  };

  if (user?.role !== 'ADMIN') {
    return (
      <div className="empty">
        <IconShield />
        <h2>Acceso Denegado</h2>
        <p>Solo el Administrador Global puede gestionar la infraestructura SaaS.</p>
      </div>
    );
  }

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem' }}>
        <div>
          <h1 className="page-title">Instalaciones SaaS</h1>
          <p className="page-subtitle">Red nacional de sucursales y puntos de venta</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          + Nueva Sucursal
        </button>
      </header>

      {loading ? (
        <div className="loading">Sincronizando red...</div>
      ) : (
        <div className="products-grid">
          {branches.map(b => (
            <div key={b.id} className="product-card" style={{ borderTop: '4px solid var(--purple)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.2rem' }}>
                <div>
                  <h3 className="prod-name" style={{ fontSize: '1.2rem' }}>{b.name}</h3>
                  <span className="prod-category">{b.city}</span>
                </div>
                <span 
                  className={`badge ${b.isActive ? 'badge-green' : 'badge-muted'}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleToggleStatus(b)}
                  title="Click para cambiar estado"
                >
                  {b.isActive ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: 'var(--text-2)' }}>
                  <IconMap /> {b.address}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', color: 'var(--text-2)' }}>
                  <IconPhone /> {b.phone || 'Sin línea asignada'}
                </div>
              </div>

              {/* Mini Métricas Hoy */}
              <div style={{ padding: '0.8rem', background: 'var(--bg-glass)', borderRadius: 'var(--r)', marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase' }}>Ventas Hoy</label>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--green)' }}>{formatCOP(b.todayMetrics?.amount)}</strong>
                </div>
                <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '0.8rem' }}>
                  <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase' }}>Pedidos</label>
                  <strong style={{ fontSize: '0.9rem' }}>{b.todayMetrics?.count || 0}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-3)' }}>
                <span>ID: {b.id} · {b._count?.products || 0} Productos</span>
                <button 
                  className="btn-secondary" 
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  onClick={() => openAudit(b)}
                >
                  <IconClipboard /> Ver Auditoría
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Auditoría Detallada */}
      {showAudit && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(27,27,28,0.5)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto', padding: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--purple)' }}>Registro de Auditoría</h2>
                    <p style={{ color: 'var(--text-3)', fontWeight: '600' }}>Detalle exhaustivo de ventas: <strong>{selectedBranch?.name}</strong></p>
                </div>
                <button onClick={() => setShowAudit(false)} className="btn-secondary">Cerrar</button>
            </div>

            {loadingAudit ? (
                <div className="loading">Analizando transacciones...</div>
            ) : (
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Fecha y Hora Exacta</th>
                                <th>Cliente / Canal</th>
                                <th>Desglose de Productos</th>
                                <th className="right">Valor Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditData.length > 0 ? auditData.map(order => (
                                <tr key={order.id} style={{ verticalAlign: 'top' }}>
                                    <td style={{ whiteSpace: 'nowrap' }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>{new Date(order.createdAt).toLocaleDateString()}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--purple)', fontWeight: '800' }}>
                                            <IconClock /> {new Date(order.createdAt).toLocaleTimeString()}
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ fontSize: '0.85rem', fontWeight: '700' }}>{order.contact?.name || 'Cliente Final'}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{order.contact?.phone}</div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                            {order.items?.map((item, idx) => (
                                                <div key={idx} style={{ fontSize: '0.75rem', background: 'var(--bg-glass)', padding: '0.3rem 0.6rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{item.quantity}x <strong>{item.name}</strong></span>
                                                    <span style={{ fontWeight: '700' }}>{formatCOP(item.price)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="right">
                                        <span style={{ fontSize: '1rem', fontWeight: '900', color: 'var(--green)' }}>{formatCOP(order.amount)}</span>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan="4" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)' }}>Sin movimientos registrados para esta sede.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Nueva Sucursal */}
      {showModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(27,27,28,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '2.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.15)', border: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: '800', color: 'var(--purple)', marginBottom: '0.4rem' }}>Nueva Sede</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: '2rem' }}>Configuración de infraestructura y cuenta de manager.</p>
            
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Nombre Fantasía</label>
                <input 
                  required
                  placeholder="Ej: Fantasías Popayán"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '1rem', color: 'var(--text)' }}
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Ciudad</label>
                  <input 
                    required
                    placeholder="Popayán"
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '1rem', color: 'var(--text)' }}
                    value={form.city}
                    onChange={e => setForm({...form, city: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Teléfono</label>
                  <input 
                    placeholder="312..."
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '1rem', color: 'var(--text)' }}
                    value={form.phone}
                    onChange={e => setForm({...form, phone: e.target.value})}
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Dirección Administrativa</label>
                <input 
                  required
                  placeholder="Calle 1 # 2-3..."
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '1rem', color: 'var(--text)' }}
                  value={form.address}
                  onChange={e => setForm({...form, address: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Contraseña Manager (Sede)</label>
                <input 
                  required
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '1rem', color: 'var(--text)' }}
                  value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={creating}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  {creating ? 'Creando...' : 'Activar Sede'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

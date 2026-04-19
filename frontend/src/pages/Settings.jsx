import { useState, useEffect } from 'react';
import { 
  getWhatsAppStatus, 
  initializeWhatsApp, 
  logoutWhatsApp, 
  getMetrics, 
  getWompiConfig,
  updateWompiConfig,
  formatCOP, 
  formatDate 
} from '../api';
import { useAuth } from '../context/AuthContext';
import { IconPhone, IconShield, IconAlertTriangle, IconActivity, IconLock, IconSave, IconClipboard } from '../components/Icons';
import Swal from 'sweetalert2';

export default function Settings() {
  const { isAdmin } = useAuth();
  const [waStatus, setWaStatus] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loadingWA, setLoadingWA] = useState(false);
  
  const [wompiForm, setWompiForm] = useState({
      wompiMerchantId: '',
      wompiPublicKey: '',
      wompiPrivateKey: '',
      wompiIntegritySecret: '',
      notificationGroupName: ''
  });
  const [wompiStatus, setWompiStatus] = useState({ isConfigured: false, loading: true, saving: false });

  const [formIsDirty, setFormIsDirty] = useState(false);

  const loadData = async (includeForm = false) => {
    try {
      // Polling básico: solo status y métricas para no sobrecargar ni resetear campos
      const promises = [
        getWhatsAppStatus(),
        getMetrics()
      ];
      
      // Solo traemos config de Wompi si es carga inicial o save
      if (includeForm) promises.push(getWompiConfig());

      const results = await Promise.all(promises);
      const [statusRes, auditRes, wompiRes] = results;
      
      if (statusRes?.success) setWaStatus(statusRes.data);
      if (auditRes?.success) setAudit(auditRes.data);
      
      if (includeForm && wompiRes?.success) {
          // SOLO actualizamos el formulario si el usuario NO ha empezado a escribir
          // o si es la carga inicial forzada
          setWompiForm(wompiRes.data);
          setWompiStatus(prev => ({ 
            ...prev, 
            isConfigured: wompiRes.data.isConfigured, 
            loading: false 
          }));
          setFormIsDirty(false);
      }
    } catch (err) {
      console.error("Error loading settings:", err);
    }
  };

  // 1. Carga inicial del formulario (Solo una vez al montar)
  useEffect(() => {
    loadData(true);
  }, []);

  // 2. Polling de estado (WhatsApp y Auditoría) - SIN DEPENDECIAS que causen re-mount
  useEffect(() => {
    const interval = setInterval(() => {
        // Polling ligero: solo estado de conexión y métricas
        loadData(false);
    }, 5000); 
    return () => clearInterval(interval);
  }, []); 

  const handleConnect = async () => {
    setLoadingWA(true);
    await initializeWhatsApp();
    await loadData(false);
    setLoadingWA(false);
  };

  const handleLogoutWA = async () => {
    const result = await Swal.fire({
      title: '¿Cerrar sesión de WhatsApp?',
      text: 'Tendrás que escanear el QR de nuevo para reconectar.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--red)',
      cancelButtonColor: 'var(--text-3)',
      confirmButtonText: 'Sí, cerrar sesión',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    
    await logoutWhatsApp();
    await loadData(false);
  };

  const handleWompiSave = async (e) => {
    e.preventDefault();
    setWompiStatus(prev => ({ ...prev, saving: true }));
    const r = await updateWompiConfig(wompiForm);
    setWompiStatus(prev => ({ ...prev, saving: false }));
    if (r?.success) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Configuración actualizada',
          showConfirmButton: false,
          timer: 2000
        });
        loadData(true);
    } else {
        Swal.fire('Error', r?.error || 'Error desconocido', 'error');
    }
  };

  const wompiMissing = !wompiForm.wompiMerchantId || !wompiForm.wompiPublicKey || !wompiForm.wompiPrivateKey;

  return (
    <div>
      <header style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Infraestructura de pagos y canal de ventas</p>
      </header>

      <div className="settings-grid" style={{ marginBottom: '2rem' }}>
        {/* WhatsApp Connection Card */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-title" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <IconPhone /> Canal de Ventas WhatsApp
            </span>
            <span className={`badge ${waStatus?.isReady ? 'badge-green' : 'badge-muted'}`}>
              {waStatus?.isReady ? 'CONECTADO' : 'Desconectado'}
            </span>
          </div>
          
          <div className="card-body">
            {!waStatus?.isReady ? (
              <div>
                {waStatus?.qr ? (
                  <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                    <p style={{ color: 'var(--text-2)', fontWeight: '600', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
                      Escanea este código con tu WhatsApp Business corporativo:
                    </p>
                    <div style={{ display: 'inline-block', padding: '1.5rem', background: '#fff', borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.08)', border: '1px solid var(--border)' }}>
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(waStatus.qr)}`} 
                          alt="WhatsApp QR Code" 
                          style={{ width: '260px', height: '260px', display: 'block' }} 
                        />
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'var(--bg-0)', borderRadius: 'var(--r)' }}>
                    <div style={{ marginBottom: '1rem', color: 'var(--text-3)' }}><IconPhone /></div>
                    <p style={{ fontWeight: '700', color: 'var(--text-2)', marginBottom: '1.5rem' }}>
                      Sesión de WhatsApp inactiva para esta sucursal.
                    </p>
                    {(!wompiStatus.isConfigured && wompiMissing) && (
                      <div style={{ padding: '1rem', background: 'rgba(180,83,9,0.06)', border: '1px solid rgba(180,83,9,0.15)', borderRadius: '10px', marginBottom: '1.5rem', maxWidth: '420px', margin: '0 auto 1.5rem' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: '800', color: 'var(--gold)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                          <IconAlertTriangle /> Configuración Requerida
                        </p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
                          Debes configurar y guardar tus credenciales de <strong>Wompi</strong> antes de conectar WhatsApp.
                        </p>
                      </div>
                    )}
                    <button 
                      onClick={handleConnect} 
                      className="btn-primary"
                      disabled={loadingWA || !wompiStatus.isConfigured || formIsDirty}
                    >
                      {loadingWA ? 'Iniciando...' : 'Generar QR de Conexión'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', padding: '1.5rem', background: 'var(--green-bg)', borderRadius: 'var(--r-lg)', border: '1px solid rgba(45,138,92,0.1)', marginBottom: '1rem' }}>
                    <div style={{ color: 'var(--green)' }}><IconActivity /></div>
                    <div>
                        <p style={{ fontWeight: '800', fontSize: '1.1rem', color: 'var(--green)', letterSpacing: '0.5px' }}>
                          <span className="dot-pulse"></span> CONECTADO
                        </p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-2)' }}>El bot Fantasías está operando con éxito en esta sucursal.</p>
                    </div>
                </div>
                <button onClick={handleLogoutWA} style={{ fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    Desvincular y Cerrar Sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.2rem', marginBottom: '2rem' }}>
        {/* Wompi Config Card */}
        <div className="card" style={{ borderTop: '3px solid var(--purple)' }}>
            <div className="card-title" style={{ justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <IconShield /> Pasarela Wompi
                </span>
                <span className={`badge ${wompiStatus.isConfigured ? 'badge-purple' : 'badge-muted'}`}>
                    {wompiStatus.isConfigured ? 'Activa' : 'Pendiente'}
                </span>
            </div>
            
            <form onSubmit={handleWompiSave}>
              <div className="card-body">
                <div className="form-grid">
                    <div className="form-group">
                        <label>Merchant ID</label>
                        <input 
                            value={wompiForm.wompiMerchantId}
                            onChange={e => {
                                setWompiForm({...wompiForm, wompiMerchantId: e.target.value});
                                setFormIsDirty(true);
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label>Public Key</label>
                        <input 
                            value={wompiForm.wompiPublicKey}
                            onChange={e => {
                                setWompiForm({...wompiForm, wompiPublicKey: e.target.value});
                                setFormIsDirty(true);
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label>Private Key (Secret)</label>
                        <input 
                            type="password"
                            placeholder="••••••••••••••••"
                            value={wompiForm.wompiPrivateKey}
                            onChange={e => {
                                setWompiForm({...wompiForm, wompiPrivateKey: e.target.value});
                                setFormIsDirty(true);
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label>Integrity Secret (Firma)</label>
                        <input 
                            type="password"
                            placeholder="••••••••••••••••"
                            value={wompiForm.wompiIntegritySecret}
                            onChange={e => {
                                setWompiForm({...wompiForm, wompiIntegritySecret: e.target.value});
                                setFormIsDirty(true);
                            }}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem' }}>
                    <button 
                        type="submit" 
                        className="btn-primary" 
                        disabled={wompiStatus.saving}
                    >
                        <IconSave /> {wompiStatus.saving ? 'Sincronizando...' : 'Guardar Credenciales'}
                    </button>
                </div>
              </div>
            </form>
        </div>

        {/* Notification Group + Audit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div className="card" style={{ background: 'var(--purple)', color: 'white' }}>
              <div className="card-body">
                <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1.5px', opacity: 0.7, marginBottom: '0.6rem' }}>Grupo de Notificación</label>
                <input 
                    style={{ width: '100%', padding: '0.6rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', fontSize: '0.85rem', color: 'white', outline: 'none' }}
                    placeholder="Ej: Despachos Popayán"
                    value={wompiForm.notificationGroupName}
                    onChange={e => {
                        setWompiForm({...wompiForm, notificationGroupName: e.target.value});
                        setFormIsDirty(true);
                    }}
                />
                <p style={{ fontSize: '0.65rem', opacity: 0.5, marginTop: '0.5rem', lineHeight: 1.5 }}>
                    El bot enviará los detalles de cada venta exitosa a este grupo de WhatsApp.
                </p>
              </div>
          </div>

          {isAdmin && (
            <div className="card" style={{ borderLeft: '3px solid var(--purple)', flex: 1 }}>
              <div className="card-title"><IconClipboard /> Auditoría</div>
              <div className="card-body">
                {audit.length > 0 ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>ID</th><th>Status</th><th className="right">Importe</th></tr></thead>
                      <tbody>
                        {audit.slice(0, 5).map(a => (
                          <tr key={a.id}>
                            <td className="mono">#{a.id}</td>
                            <td>
                                <span className={`badge ${a.action === 'PAID' ? 'badge-green' : 'badge-red'}`}>
                                    {a.action === 'PAID' ? 'LIQUIDADO' : a.action}
                                </span>
                            </td>
                            <td className="right" style={{ fontWeight: '800', color: 'var(--purple)' }}>{formatCOP(a.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-3)' }}>
                      Sin transacciones registradas
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .dot-pulse {
          display: inline-block;
          width: 10px; height: 10px;
          background: var(--green);
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse-green 1.5s infinite;
        }
        @keyframes pulse-green {
          0% { box-shadow: 0 0 0 0 rgba(45, 138, 92, 0.7); }
          70% { box-shadow: 0 0 0 8px rgba(45, 138, 92, 0); }
          100% { box-shadow: 0 0 0 0 rgba(45, 138, 92, 0); }
        }
      `}</style>
    </div>
  );
}

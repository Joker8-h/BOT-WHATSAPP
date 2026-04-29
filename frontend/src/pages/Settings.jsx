import { useState, useEffect } from 'react';
import { 
  getWhatsAppStatus, 
  initializeWhatsApp, 
  logoutWhatsApp, 
  getMetrics, 
  getWompiConfig,
  updateWompiConfig,
  getSyncSources,
  createSyncSource,
  deleteSyncSource,
  triggerSync,
  formatCOP, 
  formatDate 
} from '../api';
import { useAuth } from '../context/AuthContext';
import { IconPhone, IconShield, IconAlertTriangle, IconActivity, IconLock, IconSave, IconClipboard, IconPlus, IconTrash } from '../components/Icons';
import Swal from 'sweetalert2';

export default function Settings() {
  const { isAdmin, user } = useAuth();
  const isMasterBranch = user?.branchId === 1 || isAdmin;
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
  const [syncSources, setSyncSources] = useState([]);
  const [newSync, setNewSync] = useState({ name: '', url: '' });
  const [syncing, setSyncing] = useState(false);

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

      const syncRes = await getSyncSources();
      if (syncRes?.success) setSyncSources(syncRes.data);
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

  const handleAddSync = async (e) => {
    e.preventDefault();
    const res = await createSyncSource(newSync);
    if (res?.success) {
      setNewSync({ name: '', url: '' });
      loadData(false);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Fuente añadida', showConfirmButton: false, timer: 1500 });
    }
  };

  const handleDeleteSync = async (id) => {
    const res = await deleteSyncSource(id);
    if (res?.success) loadData(false);
  };

  const handleTriggerSync = async (id) => {
    setSyncing(true);
    const res = await triggerSync(id);
    if (res?.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Sincronización iniciada', showConfirmButton: false, timer: 2000 });
      setTimeout(() => loadData(false), 5000);
    }
    setSyncing(false);
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
        {/* WhatsApp Connection Card - SOLO MASTER */}
        {isMasterBranch && (
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
        )}
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
                {isMasterBranch && (
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
                )}

                <div style={{ padding: '1rem', background: 'var(--bg-1)', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', color: 'var(--purple)' }}>
                        <IconPhone />
                        <span style={{ fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px' }}>Grupo de Notificación WhatsApp</span>
                    </div>
                    <input 
                        style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-1)', outline: 'none' }}
                        placeholder="Ej: Despachos Popayán"
                        value={wompiForm.notificationGroupName}
                        onChange={e => {
                            setWompiForm({...wompiForm, notificationGroupName: e.target.value});
                            setFormIsDirty(true);
                        }}
                    />
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: '0.6rem', lineHeight: 1.4 }}>
                        Ingresa el nombre del grupo de WhatsApp donde el bot enviará los reportes de ventas automáticos.
                    </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem' }}>
                    <button 
                        type="submit" 
                        className="btn-primary" 
                        disabled={wompiStatus.saving}
                        style={{ width: '100%', padding: '1rem' }}
                    >
                        <IconSave /> {wompiStatus.saving ? 'Sincronizando...' : 'Guardar Configuración General'}
                    </button>
                </div>
              </div>
            </form>
        </div>

        {/* Audit Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

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

        {/* ── SECCIÓN: GOOGLE DRIVE SYNC ── */}
        <div className="card" style={{ gridColumn: '1 / -1', marginTop: '1.5rem', borderTop: '4px solid var(--purple)' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <IconClipboard /> 
            <div>
              <div style={{ fontWeight: '900', fontSize: '1rem', color: 'var(--text-1)' }}>Sincronización Google Drive</div>
              <div style={{ fontWeight: '400', fontSize: '0.7rem', color: 'var(--text-3)' }}>Conecta tus hojas de Excel para actualizar el inventario automáticamente</div>
            </div>
          </div>
          
          <div className="card-body">
            <form onSubmit={handleAddSync} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '1rem', alignItems: 'flex-end', marginBottom: '2rem', padding: '1.5rem', background: 'var(--bg-1)', borderRadius: '12px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.65rem', fontWeight: '800', marginBottom: '0.5rem', display: 'block' }}>Nombre de la Fuente</label>
                <input required value={newSync.name} onChange={e => setNewSync({...newSync, name: e.target.value})} placeholder="Ej: Excel Bodega" 
                  style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-0)' }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.65rem', fontWeight: '800', marginBottom: '0.5rem', display: 'block' }}>URL de Google Drive</label>
                <input required value={newSync.url} onChange={e => setNewSync({...newSync, url: e.target.value})} placeholder="https://docs.google.com/spreadsheets/d/..." 
                  style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-0)' }} />
              </div>
              <button type="submit" className="btn-secondary" style={{ height: '42px', padding: '0 1.5rem' }}>
                 Añadir
              </button>
            </form>

            <div className="sync-list">
              {syncSources.map(s => (
                <div key={s.id} className="sync-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem', background: 'var(--bg-0)', borderRadius: '12px', marginBottom: '0.75rem', border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-1)' }}>{s.name}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--purple)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px', marginTop: '0.2rem' }}>{s.url}</div>
                    <div style={{ fontSize: '0.7rem', marginTop: '0.6rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <span style={{ 
                        padding: '0.2rem 0.5rem', 
                        borderRadius: '4px', 
                        fontSize: '0.6rem', 
                        fontWeight: '900',
                        background: s.lastStatus === 'SUCCESS' ? 'rgba(45, 138, 92, 0.1)' : 'rgba(220, 53, 69, 0.1)',
                        color: s.lastStatus === 'SUCCESS' ? 'var(--green)' : 'var(--red)'
                      }}>
                        {s.lastStatus || 'PENDIENTE'}
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>
                        {s.lastSyncAt ? `Última sincronización: ${formatDate(s.lastSyncAt)}` : 'Nunca sincronizado'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn-secondary" style={{ fontSize: '0.75rem' }} onClick={() => handleTriggerSync(s.id)} disabled={syncing}>
                      {syncing ? '...' : 'Sincronizar'}
                    </button>
                    <button className="btn-danger" style={{ padding: '0.6rem', borderRadius: '8px' }} onClick={() => handleDeleteSync(s.id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
              {syncSources.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-3)', border: '2px dashed var(--border)', borderRadius: '12px' }}>
                  No hay fuentes de Drive configuradas.
                </div>
              )}
            </div>
          </div>
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

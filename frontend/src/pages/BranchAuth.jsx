import { useState, useEffect } from 'react';
import { getPendingBranches, authorizeBranch, formatDate } from '../api';
import Swal from 'sweetalert2';

export default function BranchAuth() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    fetchPending();
  }, []);

  const fetchPending = async () => {
    setLoading(true);
    const res = await getPendingBranches();
    if (res?.success) {
      setBranches(res.data);
    } else {
      setError('Error al cargar sucursales pendientes');
    }
    setLoading(false);
  };

  const handleAuthorize = async (id) => {
    const result = await Swal.fire({
      title: '¿Autorizar esta sucursal?',
      text: 'El gestor recibirá acceso completo al panel y al bot de WhatsApp.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: 'var(--purple)',
      cancelButtonColor: 'var(--text-3)',
      confirmButtonText: 'Sí, autorizar acceso',
      cancelButtonText: 'Cancelar'
    });
    
    if (!result.isConfirmed) return;
    
    setProcessingId(id);
    const res = await authorizeBranch(id);
    if (res?.success) {
      setBranches(branches.filter(b => b.id !== id));
      Swal.fire({
        title: '¡Sede Autorizada!',
        text: 'La sucursal ha sido activada y notificada correctamente.',
        icon: 'success'
      });
    } else {
      Swal.fire('Error', res?.error || 'No se pudo autorizar', 'error');
    }
    setProcessingId(null);
  };

  if (loading) return <div className="p-6">Cargando solicitudes...</div>;

  return (
    <div className="page-container p-6">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="page-title" style={{ fontSize: '2.4rem', fontWeight: '800', color: 'var(--purple)' }}>Autorización de Sedes</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-3)', fontSize: '1rem' }}>Gestiona las solicitudes de nuevas sedes en el país</p>
        </div>
        <button onClick={fetchPending} className="btn-secondary">Actualizar</button>
      </header>

      {error && <div className="error-box mb-6">{error}</div>}

      {branches.length === 0 ? (
        <div className="card text-center p-12" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '3.5rem', display: 'block', marginBottom: '1rem' }}>✨</span>
          <h3 style={{ color: 'var(--purple)', fontWeight: 'bold', fontSize: '1.2rem' }}>No hay solicitudes pendientes</h3>
          <p style={{ color: 'var(--text-3)' }}>Todas las sucursales registradas han sido procesadas.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {branches.map(branch => (
            <div key={branch.id} className="metric-card accent-purple flex justify-between items-center p-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-lg font-bold" style={{ color: 'var(--text)' }}>{branch.name}</h3>
                  <span className="badge-pending">Revisión Pendiente</span>
                </div>
                <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
                  {branch.city} — {branch.address}
                </p>
                <div className="flex gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
                  <span>Gestor: <strong style={{ color: 'var(--text)' }}>{branch.users[0]?.username}</strong></span>
                  <span>{branch.users[0]?.email}</span>
                  <span>Solicitado: {formatDate(branch.createdAt)}</span>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => handleAuthorize(branch.id)}
                  className="btn-primary"
                  disabled={processingId === branch.id}
                  style={{ padding: '0.8rem 1.5rem', borderRadius: 'var(--r)' }}
                >
                  {processingId === branch.id ? 'Procesando...' : 'Autorizar Acceso'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .badge-pending {
          background: var(--purple-bg);
          color: var(--purple);
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 0.65rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
      `}</style>
    </div>
  );
}

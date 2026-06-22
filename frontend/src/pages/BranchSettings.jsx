import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBranch, updateBranchSettings, formatDate } from '../api';
import { IconSave, IconArrowLeft, IconMap, IconPhone, IconEdit } from '../components/Icons';
import Swal from 'sweetalert2';

export default function BranchSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', city: '', address: '', phone: '',
    referencePoint: '', notes: '', storeFrontDesc: '',
  });

  useEffect(() => {
    loadBranch();
  }, [id]);

  const loadBranch = async () => {
    setLoading(true);
    const res = await getBranch(id);
    if (res?.success) {
      setBranch(res.data);
      setForm({
        name: res.data.name || '',
        city: res.data.city || '',
        address: res.data.address || '',
        phone: res.data.phone || '',
        referencePoint: res.data.referencePoint || '',
        notes: res.data.notes || '',
        storeFrontDesc: res.data.storeFrontDesc || '',
      });
    }
    setLoading(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const res = await updateBranchSettings(id, form);
    setSaving(false);
    if (res?.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Sede actualizada', showConfirmButton: false, timer: 2000 });
      loadBranch();
    } else {
      Swal.fire('Error', res?.error || 'No se pudo guardar', 'error');
    }
  };

  if (loading) return <div className="loading">Cargando sede...</div>;

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem' }}>
        <div>
          <button onClick={() => navigate('/branches/management')} className="btn-secondary" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <IconArrowLeft /> Volver a Sedes
          </button>
          <h1 className="page-title">{branch?.name}</h1>
          <p className="page-subtitle">Configuración de la sede</p>
        </div>
      </header>

      <div className="card" style={{ maxWidth: '700px', padding: '2rem' }}>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>Nombre de sede</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Ciudad</label>
              <input value={form.city} onChange={e => setForm({...form, city: e.target.value})} />
            </div>
          </div>

          <div className="form-group">
            <label>Dirección</label>
            <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
          </div>

          <div className="form-group">
            <label>Teléfono</label>
            <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
          </div>

          <div className="form-group">
            <label>Punto de referencia</label>
            <textarea rows={2} value={form.referencePoint} onChange={e => setForm({...form, referencePoint: e.target.value})} placeholder="Ej: Sobre la misma cuadra del Gimnasio de la Salud" />
          </div>

          <div className="form-group">
            <label>Descripción de fachada</label>
            <textarea rows={2} value={form.storeFrontDesc} onChange={e => setForm({...form, storeFrontDesc: e.target.value})} placeholder="Ej: Fachada de dos pisos color negro" />
          </div>

          <div className="form-group">
            <label>Notas adicionales</label>
            <textarea rows={4} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Ej: Estamos próximos a trasladarnos..." />
          </div>

          <button type="submit" disabled={saving} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
            <IconSave /> {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </form>
      </div>

      <style>{`
        .form-group label { display: block; font-size: 0.65rem; font-weight: 800; color: var(--text-3); text-transform: uppercase; margin-bottom: 0.4rem; }
        .form-group input, .form-group textarea { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-1); font-size: 0.95rem; color: var(--text); font-family: var(--font); resize: vertical; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--purple); }
      `}</style>
    </div>
  );
}

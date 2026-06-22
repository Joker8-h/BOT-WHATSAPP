import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBranch, updateBranchSettings, updateBranchSchedule, formatDate } from '../api';
import { IconSave, IconArrowLeft, IconMap, IconPhone, IconEdit } from '../components/Icons';
import Swal from 'sweetalert2';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

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
  const [scheduleForm, setScheduleForm] = useState({
    useGlobalSchedule: true,
    workingHoursStart: 9,
    workingHoursEnd: 18,
    workingDays: '1,2,3,4,5,6',
    closedForLunch: false,
    lunchStart: 12,
    lunchEnd: 13,
  });

  useEffect(() => { loadBranch(); }, [id]);

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
      setScheduleForm({
        useGlobalSchedule: res.data.useGlobalSchedule ?? true,
        workingHoursStart: res.data.workingHoursStart ?? 9,
        workingHoursEnd: res.data.workingHoursEnd ?? 18,
        workingDays: res.data.workingDays || '1,2,3,4,5,6',
        closedForLunch: res.data.closedForLunch ?? false,
        lunchStart: res.data.lunchStart ?? 12,
        lunchEnd: res.data.lunchEnd ?? 13,
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

  const handleSaveSchedule = async () => {
    setSaving(true);
    const res = await updateBranchSchedule(id, scheduleForm);
    setSaving(false);
    if (res?.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Horario actualizado', showConfirmButton: false, timer: 2000 });
      loadBranch();
    } else {
      Swal.fire('Error', res?.error || 'No se pudo guardar', 'error');
    }
  };

  const toggleDay = (dayNum) => {
    const days = scheduleForm.workingDays.split(',').map(Number);
    if (days.includes(dayNum)) {
      if (days.length > 1) setScheduleForm({ ...scheduleForm, workingDays: days.filter(d => d !== dayNum).join(',') });
    } else {
      setScheduleForm({ ...scheduleForm, workingDays: [...days, dayNum].sort().join(',') });
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

      {/* Info general */}
      <div className="card" style={{ maxWidth: '700px', padding: '2rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--purple)' }}>Información General</h2>
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

      {/* Horario */}
      <div className="card" style={{ maxWidth: '700px', padding: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--purple)' }}>Horario de Atención</h2>
        <div className="flex items-center gap-3 mb-4">
          <input type="checkbox" checked={scheduleForm.useGlobalSchedule}
            onChange={e => setScheduleForm({ ...scheduleForm, useGlobalSchedule: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded" />
          <span className="text-sm text-gray-600">Usar horario global del sistema</span>
        </div>

        {!scheduleForm.useGlobalSchedule && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label>Hora inicio</label>
                <input type="number" min="0" max="23" value={scheduleForm.workingHoursStart}
                  onChange={e => setScheduleForm({ ...scheduleForm, workingHoursStart: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="form-group">
                <label>Hora fin</label>
                <input type="number" min="0" max="23" value={scheduleForm.workingHoursEnd}
                  onChange={e => setScheduleForm({ ...scheduleForm, workingHoursEnd: parseInt(e.target.value) || 0 })} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Días de atención</label>
              <div className="flex gap-2">
                {[0,1,2,3,4,5,6].map(d => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`w-12 h-10 rounded-lg text-sm font-medium transition-colors ${
                      scheduleForm.workingDays.split(',').map(Number).includes(d)
                        ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>{DIAS[d]}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input type="checkbox" checked={scheduleForm.closedForLunch}
                onChange={e => setScheduleForm({ ...scheduleForm, closedForLunch: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded" />
              <span className="text-sm text-gray-600">Cerrado en horario de almuerzo</span>
            </div>

            {scheduleForm.closedForLunch && (
              <div className="grid grid-cols-2 gap-4 ml-7">
                <div className="form-group">
                  <label>Desde</label>
                  <input type="number" min="0" max="23" value={scheduleForm.lunchStart}
                    onChange={e => setScheduleForm({ ...scheduleForm, lunchStart: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="form-group">
                  <label>Hasta</label>
                  <input type="number" min="0" max="23" value={scheduleForm.lunchEnd}
                    onChange={e => setScheduleForm({ ...scheduleForm, lunchEnd: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
            )}

            <button type="button" onClick={handleSaveSchedule} disabled={saving}
              className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
              <IconSave /> Guardar Horario
            </button>
          </div>
        )}

        {scheduleForm.useGlobalSchedule && (
          <p className="text-sm text-gray-500 italic">Esta sede usa el horario global configurado en Configuración del Sistema.</p>
        )}
      </div>

      <style>{`
        .form-group label { display: block; font-size: 0.65rem; font-weight: 800; color: var(--text-3); text-transform: uppercase; margin-bottom: 0.4rem; }
        .form-group input, .form-group textarea { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-1); font-size: 0.95rem; color: var(--text); font-family: var(--font); resize: vertical; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--purple); }
      `}</style>
    </div>
  );
}

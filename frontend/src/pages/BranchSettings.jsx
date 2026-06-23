import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBranch, updateBranchSettings, updateBranchSchedule, getAdminLids, addAdminLid, removeAdminLid, formatDate } from '../api';
import { IconSave, IconArrowLeft } from '../components/Icons';
import Swal from 'sweetalert2';

const DIAS = [
  { num: 0, short: 'Dom' },
  { num: 1, short: 'Lun' },
  { num: 2, short: 'Mar' },
  { num: 3, short: 'Mie' },
  { num: 4, short: 'Jue' },
  { num: 5, short: 'Vie' },
  { num: 6, short: 'Sab' },
];

function formatHour(h) {
  if (h === 0 || h === 24) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

export default function BranchSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
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
  const [adminLids, setAdminLids] = useState([]);
  const [newAdminLid, setNewAdminLid] = useState('');
  const [newAdminName, setNewAdminName] = useState('');

  useEffect(() => { loadBranch(); loadAdminLids(); }, [id]);

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

  const loadAdminLids = async () => {
    const res = await getAdminLids(id);
    if (res?.success) setAdminLids(res.data || []);
  };

  const handleAddAdminLid = async () => {
    if (!newAdminLid.trim()) return;
    const res = await addAdminLid(id, { lid: newAdminLid.trim(), name: newAdminName.trim() || 'Admin' });
    if (res?.success) {
      setAdminLids(res.data);
      setNewAdminLid('');
      setNewAdminName('');
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Admin agregado', showConfirmButton: false, timer: 1500 });
    } else {
      Swal.fire('Error', res?.error || 'No se pudo agregar', 'error');
    }
  };

  const handleRemoveAdminLid = async (lid) => {
    const result = await Swal.fire({ title: '¿Eliminar este admin?', icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--red)', confirmButtonText: 'Eliminar' });
    if (!result.isConfirmed) return;
    const res = await removeAdminLid(id, lid);
    if (res?.success) {
      setAdminLids(res.data);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Admin eliminado', showConfirmButton: false, timer: 1500 });
    }
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

  const activeDaysCount = scheduleForm.workingDays.split(',').length;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-3)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
        <p>Cargando sede...</p>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => navigate('/branches/management')} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-2)' }}>
          <IconArrowLeft />
        </button>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>{branch?.name || 'Sede'}</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>{branch?.city}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => setActiveTab('info')} style={tabStyle(activeTab === 'info')}>
          🏪 Información General
        </button>
        <button onClick={() => setActiveTab('schedule')} style={tabStyle(activeTab === 'schedule')}>
          🕐 Horario de Atención
        </button>
        <button onClick={() => setActiveTab('admins')} style={tabStyle(activeTab === 'admins')}>
          👑 Admins ({adminLids.length})
        </button>
      </div>

      {/* Tab: Info General */}
      {activeTab === 'info' && (
        <form onSubmit={handleSave}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <span style={cardIconStyle}>📍</span>
              <div>
                <h3 style={cardTitleStyle}>Datos de la Sede</h3>
                <p style={cardSubtitleStyle}>Información de contacto y ubicación</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.2rem' }}>
              <div>
                <label style={labelStyle}>Nombre de Sede</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Ciudad</label>
                <input value={form.city} onChange={e => setForm({...form, city: e.target.value})} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={labelStyle}>Dirección</label>
              <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} style={inputStyle} placeholder="Calle, número, barrio" />
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={labelStyle}>Teléfono</label>
              <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} style={inputStyle} placeholder="+57 300 123 4567" />
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={labelStyle}>Punto de Referencia</label>
              <textarea rows={2} value={form.referencePoint} onChange={e => setForm({...form, referencePoint: e.target.value})} style={textareaStyle} placeholder="Ej: Sobre la misma cuadra del Gimnasio de la Salud" />
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={labelStyle}>Descripción de Fachada</label>
              <textarea rows={2} value={form.storeFrontDesc} onChange={e => setForm({...form, storeFrontDesc: e.target.value})} style={textareaStyle} placeholder="Ej: Fachada de dos pisos color negro" />
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={labelStyle}>Notas Adicionales</label>
              <textarea rows={3} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} style={textareaStyle} placeholder="Ej: Estamos próximos a trasladarnos..." />
            </div>
          </div>

          <button type="submit" disabled={saving}
            style={{
              width: '100%', padding: '1rem', borderRadius: 'var(--r-lg)', border: 'none',
              background: saving ? 'var(--text-3)' : 'var(--purple)', color: '#fff',
              fontSize: '0.95rem', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
              boxShadow: '0 4px 15px rgba(83, 16, 110, 0.3)',
            }}>
            <IconSave />
            {saving ? 'Guardando...' : 'Guardar Información'}
          </button>
        </form>
      )}

      {/* Tab: Horario */}
      {activeTab === 'schedule' && (
        <div>
          {/* Toggle Card */}
          <div style={{ ...cardStyle, background: scheduleForm.useGlobalSchedule ? 'var(--green-bg)' : 'var(--bg-card)', borderColor: scheduleForm.useGlobalSchedule ? 'rgba(45,138,92,0.2)' : 'var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ ...cardIconStyle, background: scheduleForm.useGlobalSchedule ? 'rgba(45,138,92,0.15)' : 'var(--purple-bg)' }}>
                  {scheduleForm.useGlobalSchedule ? '🌍' : '🎯'}
                </span>
                <div>
                  <h3 style={{ ...cardTitleStyle, color: scheduleForm.useGlobalSchedule ? 'var(--green)' : 'var(--purple)' }}>
                    {scheduleForm.useGlobalSchedule ? 'Usando Horario Global' : 'Horario Propio de Esta Sede'}
                  </h3>
                  <p style={cardSubtitleStyle}>
                    {scheduleForm.useGlobalSchedule
                      ? 'Esta sede sigue el horario configurado en Configuración del Sistema'
                      : 'Horario personalizado para esta sede específica'}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setScheduleForm({ ...scheduleForm, useGlobalSchedule: !scheduleForm.useGlobalSchedule })}
                style={{
                  width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer', position: 'relative',
                  background: scheduleForm.useGlobalSchedule ? 'var(--green)' : 'var(--purple)', transition: 'background 0.3s', flexShrink: 0,
                }}>
                <span style={{
                  position: 'absolute', top: '3px', left: scheduleForm.useGlobalSchedule ? '27px' : '3px',
                  width: '22px', height: '22px', borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.3s',
                }} />
              </button>
            </div>
          </div>

          {/* Horario personalizado */}
          {!scheduleForm.useGlobalSchedule && (
            <>
              {/* Horas */}
              <div style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <span style={cardIconStyle}>⏰</span>
                  <div>
                    <h3 style={cardTitleStyle}>Horario de Atención</h3>
                    <p style={cardSubtitleStyle}>Horas de apertura y cierre de esta sede</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginTop: '1rem' }}>
                  <div>
                    <label style={labelStyle}>Hora de Apertura</label>
                    <select value={scheduleForm.workingHoursStart} onChange={e => setScheduleForm({ ...scheduleForm, workingHoursStart: parseInt(e.target.value) })} style={selectStyle}>
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{formatHour(i)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Hora de Cierre</label>
                    <select value={scheduleForm.workingHoursEnd} onChange={e => setScheduleForm({ ...scheduleForm, workingHoursEnd: parseInt(e.target.value) })} style={selectStyle}>
                      {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{formatHour(i)}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Días */}
              <div style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <span style={cardIconStyle}>📅</span>
                  <div>
                    <h3 style={cardTitleStyle}>Días de Atención</h3>
                    <p style={cardSubtitleStyle}>{activeDaysCount} día{activeDaysCount !== 1 ? 's' : ''} seleccionado{activeDaysCount !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  {DIAS.map(d => {
                    const isActive = scheduleForm.workingDays.split(',').map(Number).includes(d.num);
                    return (
                      <button key={d.num} type="button" onClick={() => toggleDay(d.num)}
                        style={{
                          width: '64px', height: '64px', borderRadius: '14px', border: isActive ? '2px solid var(--green)' : '2px solid var(--border)',
                          background: isActive ? 'var(--green-bg)' : 'var(--bg-1)', cursor: 'pointer', transition: 'all 0.2s',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.2rem',
                        }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 800, color: isActive ? 'var(--green)' : 'var(--text-3)' }}>{d.short}</span>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? 'var(--green)' : 'var(--text-3)', opacity: isActive ? 1 : 0.3 }} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Almuerzo */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={cardIconStyle}>🍽️</span>
                    <div>
                      <h3 style={cardTitleStyle}>Parada de Almuerzo</h3>
                      <p style={cardSubtitleStyle}>¿La sede cierra durante el almuerzo?</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setScheduleForm({ ...scheduleForm, closedForLunch: !scheduleForm.closedForLunch })}
                    style={{
                      width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer', position: 'relative',
                      background: scheduleForm.closedForLunch ? 'var(--green)' : 'var(--border)', transition: 'background 0.3s',
                    }}>
                    <span style={{
                      position: 'absolute', top: '3px', left: scheduleForm.closedForLunch ? '27px' : '3px',
                      width: '22px', height: '22px', borderRadius: '50%', background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.3s',
                    }} />
                  </button>
                </div>
                {scheduleForm.closedForLunch && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                    <div>
                      <label style={labelStyle}>Desde</label>
                      <select value={scheduleForm.lunchStart} onChange={e => setScheduleForm({ ...scheduleForm, lunchStart: parseInt(e.target.value) })} style={selectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{formatHour(i)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Hasta</label>
                      <select value={scheduleForm.lunchEnd} onChange={e => setScheduleForm({ ...scheduleForm, lunchEnd: parseInt(e.target.value) })} style={selectStyle}>
                        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{formatHour(i)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Botón Guardar */}
              <button type="button" onClick={handleSaveSchedule} disabled={saving}
                style={{
                  width: '100%', padding: '1rem', borderRadius: 'var(--r-lg)', border: 'none',
                  background: saving ? 'var(--text-3)' : 'var(--purple)', color: '#fff',
                  fontSize: '0.95rem', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                  boxShadow: '0 4px 15px rgba(83, 16, 110, 0.3)',
                }}>
                <IconSave />
                {saving ? 'Guardando...' : 'Guardar Horario'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Tab: Admins */}
      {activeTab === 'admins' && (
        <div>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}>
              <span style={cardIconStyle}>👑</span>
              <div>
                <h3 style={cardTitleStyle}>Admins de esta Sede</h3>
                <p style={cardSubtitleStyle}>WhatsApp LIDs autorizados para recibir info y hacer preguntas (nunca reciben ventas)</p>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>LID de WhatsApp</label>
                  <input type="text" value={newAdminLid} onChange={e => setNewAdminLid(e.target.value)}
                    placeholder="Ej: 261783138865208"
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Nombre (opcional)</label>
                  <input type="text" value={newAdminName} onChange={e => setNewAdminName(e.target.value)}
                    placeholder="Ej: Andrés"
                    style={inputStyle} />
                </div>
              </div>
              <button type="button" onClick={handleAddAdminLid} disabled={!newAdminLid.trim()}
                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--r)', border: 'none', background: newAdminLid.trim() ? 'var(--purple)' : 'var(--text-3)', color: '#fff', fontSize: '0.85rem', fontWeight: 700, cursor: newAdminLid.trim() ? 'pointer' : 'not-allowed' }}>
                + Agregar Admin
              </button>
            </div>

            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              {adminLids.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {adminLids.map((entry, idx) => (
                    <div key={entry.lid || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--bg-1)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9rem' }}>{entry.name || 'Admin'}</span>
                        <span style={{ color: 'var(--text-3)', fontSize: '0.8rem', marginLeft: '0.75rem' }}>{entry.lid}</span>
                      </div>
                      <button type="button" onClick={() => handleRemoveAdminLid(entry.lid)}
                        style={{ background: 'var(--red-bg)', color: 'var(--red)', border: 'none', borderRadius: '6px', padding: '0.35rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '1.5rem', background: 'var(--bg-1)', borderRadius: 'var(--r)', color: 'var(--text-3)', fontSize: '0.85rem' }}>
                  No hay admins registrados. Los admins se detectan automáticamente cuando escriben al bot, o puedes agregarlos manualmente con su LID.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  background: 'var(--bg-card)', borderRadius: 'var(--r-lg)', padding: '1.5rem',
  border: '1px solid var(--border)', boxShadow: 'var(--glow)', marginBottom: '1rem',
};

const cardHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: '0.8rem',
};

const cardIconStyle = {
  width: '40px', height: '40px', borderRadius: '10px', background: 'var(--purple-bg)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0,
};

const cardTitleStyle = {
  fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', margin: 0,
};

const cardSubtitleStyle = {
  fontSize: '0.75rem', color: 'var(--text-3)', margin: 0,
};

const labelStyle = {
  display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.4rem',
};

const inputStyle = {
  width: '100%', padding: '0.75rem 0.9rem', borderRadius: 'var(--r)',
  border: '1px solid var(--border)', background: 'var(--bg-1)',
  fontSize: '0.9rem', fontFamily: 'var(--font)', color: 'var(--text)',
};

const textareaStyle = {
  ...inputStyle, resize: 'vertical', lineHeight: 1.5,
};

const selectStyle = {
  width: '100%', padding: '0.75rem 0.9rem', borderRadius: 'var(--r)',
  border: '1px solid var(--border)', background: 'var(--bg-1)',
  fontSize: '0.9rem', fontFamily: 'var(--font)', color: 'var(--text)',
  cursor: 'pointer', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b808c' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center',
};

const tabStyle = (active) => ({
  padding: '0.75rem 1.2rem', borderRadius: 'var(--r)', border: active ? '2px solid var(--purple)' : '1px solid var(--border)',
  background: active ? 'var(--purple-bg)' : 'var(--bg-2)', color: active ? 'var(--purple)' : 'var(--text-3)',
  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
});

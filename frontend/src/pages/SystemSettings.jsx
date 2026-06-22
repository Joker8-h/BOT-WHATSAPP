import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSettings, updateSettings } from '../api';
import { IconSave, IconArrowLeft } from '../components/Icons';
import Swal from 'sweetalert2';

const DIAS = [
  { num: 0, short: 'Dom', full: 'Domingo' },
  { num: 1, short: 'Lun', full: 'Lunes' },
  { num: 2, short: 'Mar', full: 'Martes' },
  { num: 3, short: 'Mie', full: 'Miércoles' },
  { num: 4, short: 'Jue', full: 'Jueves' },
  { num: 5, short: 'Vie', full: 'Viernes' },
  { num: 6, short: 'Sab', full: 'Sábado' },
];

const FESTIVOS_2026 = [
  '01-01','01-06','03-23','04-02','04-03','05-01','05-18',
  '06-08','06-15','06-29','07-20','08-07','08-17',
  '10-12','11-02','11-16','12-08','12-25'
];

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function formatHour(h) {
  if (h === 0 || h === 24) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

function parseHolidayDate(str) {
  const [m, d] = str.split('-').map(Number);
  return { month: MONTH_NAMES[m - 1], day: d, full: `${d} de ${MONTH_NAMES[m - 1]}` };
}

export default function SystemSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    workingHoursStart: 9,
    workingHoursEnd: 18,
    workingDays: '1,2,3,4,5,6',
    holidays: '[]',
    closedForLunch: false,
    lunchStart: 12,
    lunchEnd: 13,
    autoReplyMessage: '',
  });
  const [holidaysList, setHolidaysList] = useState([]);
  const [newHoliday, setNewHoliday] = useState('');

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    setLoading(true);
    const res = await getSettings();
    if (res?.success && res.data) {
      setForm({
        workingHoursStart: res.data.workingHoursStart ?? 9,
        workingHoursEnd: res.data.workingHoursEnd ?? 18,
        workingDays: res.data.workingDays || '1,2,3,4,5,6',
        holidays: res.data.holidays || '[]',
        closedForLunch: res.data.closedForLunch || false,
        lunchStart: res.data.lunchStart ?? 12,
        lunchEnd: res.data.lunchEnd ?? 13,
        autoReplyMessage: res.data.autoReplyMessage || '',
      });
      try { setHolidaysList(JSON.parse(res.data.holidays || '[]')); } catch { setHolidaysList([]); }
    }
    setLoading(false);
  };

  const toggleDay = (dayNum) => {
    const days = form.workingDays.split(',').map(Number);
    if (days.includes(dayNum)) {
      if (days.length > 1) setForm({ ...form, workingDays: days.filter(d => d !== dayNum).join(',') });
    } else {
      setForm({ ...form, workingDays: [...days, dayNum].sort().join(',') });
    }
  };

  const addHoliday = () => {
    if (newHoliday && !holidaysList.includes(newHoliday)) {
      const updated = [...holidaysList, newHoliday].sort();
      setHolidaysList(updated);
      setForm({ ...form, holidays: JSON.stringify(updated) });
      setNewHoliday('');
    }
  };

  const removeHoliday = (h) => {
    const updated = holidaysList.filter(x => x !== h);
    setHolidaysList(updated);
    setForm({ ...form, holidays: JSON.stringify(updated) });
  };

  const loadPresetHolidays = () => {
    setHolidaysList(FESTIVOS_2026);
    setForm({ ...form, holidays: JSON.stringify(FESTIVOS_2026) });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const res = await updateSettings(form);
    setSaving(false);
    if (res?.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Configuración guardada', showConfirmButton: false, timer: 2000 });
    } else {
      Swal.fire('Error', res?.error || 'No se pudo guardar', 'error');
    }
  };

  const activeDaysCount = form.workingDays.split(',').length;
  const schedulePreview = `${DIAS.filter(d => form.workingDays.split(',').map(Number).includes(d.num)).map(d => d.short).join(', ')} · ${formatHour(form.workingHoursStart)} - ${formatHour(form.workingHoursEnd)}`;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-3)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
        <p>Cargando configuración...</p>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-2)' }}>
          <IconArrowLeft />
        </button>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Horario del Sistema</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>Configuración global de atención para todas las sedes</p>
        </div>
      </div>

      {/* Preview Card */}
      <div style={{ background: 'linear-gradient(135deg, var(--purple) 0%, var(--purple-d) 100%)', borderRadius: 'var(--r-lg)', padding: '1.5rem 2rem', marginBottom: '1.5rem', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ width: '56px', height: '56px', background: 'rgba(255,255,255,0.15)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>
            🕐
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1.5px', opacity: 0.7, marginBottom: '0.3rem', fontWeight: 600 }}>Horario Activo</p>
            <p style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '0.3px' }}>{schedulePreview}</p>
            <p style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.3rem' }}>
              {activeDaysCount} días · {formatHour(form.workingHoursStart)} a {formatHour(form.workingHoursEnd)}
              {form.closedForLunch && ` · Almuerzo ${formatHour(form.lunchStart)}-${formatHour(form.lunchEnd)}`}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave}>
        {/* Sección: Horario */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <span style={cardIconStyle}>⏰</span>
            <div>
              <h3 style={cardTitleStyle}>Horario de Atención</h3>
              <p style={cardSubtitleStyle}>Define las horas de apertura y cierre</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginTop: '1rem' }}>
            <div>
              <label style={labelStyle}>Hora de Apertura</label>
              <div style={timeInputWrapperStyle}>
                <select value={form.workingHoursStart} onChange={e => setForm({ ...form, workingHoursStart: parseInt(e.target.value) })} style={timeSelectStyle}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatHour(i)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Hora de Cierre</label>
              <div style={timeInputWrapperStyle}>
                <select value={form.workingHoursEnd} onChange={e => setForm({ ...form, workingHoursEnd: parseInt(e.target.value) })} style={timeSelectStyle}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatHour(i)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Sección: Días */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <span style={cardIconStyle}>📅</span>
            <div>
              <h3 style={cardTitleStyle}>Días de Atención</h3>
              <p style={cardSubtitleStyle}>Selecciona los días que la tienda está abierta</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            {DIAS.map(d => {
              const isActive = form.workingDays.split(',').map(Number).includes(d.num);
              return (
                <button key={d.num} type="button" onClick={() => toggleDay(d.num)}
                  style={{
                    width: '72px', height: '72px', borderRadius: '14px', border: isActive ? '2px solid var(--green)' : '2px solid var(--border)',
                    background: isActive ? 'var(--green-bg)' : 'var(--bg-1)',
                    cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '0.2rem'
                  }}>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: isActive ? 'var(--green)' : 'var(--text-3)' }}>{d.short}</span>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? 'var(--green)' : 'var(--text-3)', opacity: isActive ? 1 : 0.3 }} />
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.75rem' }}>
            {activeDaysCount} día{activeDaysCount !== 1 ? 's' : ''} seleccionado{activeDaysCount !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Sección: Almuerzo */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={cardIconStyle}>🍽️</span>
              <div>
                <h3 style={cardTitleStyle}>Parada de Almuerzo</h3>
                <p style={cardSubtitleStyle}>¿La tienda cierra durante el almuerzo?</p>
              </div>
            </div>
            <button type="button" onClick={() => setForm({ ...form, closedForLunch: !form.closedForLunch })}
              style={{
                width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer', position: 'relative',
                background: form.closedForLunch ? 'var(--green)' : 'var(--border)', transition: 'background 0.3s',
              }}>
              <span style={{
                position: 'absolute', top: '3px', left: form.closedForLunch ? '27px' : '3px',
                width: '22px', height: '22px', borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.3s',
              }} />
            </button>
          </div>

          {form.closedForLunch && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <div>
                <label style={labelStyle}>Desde</label>
                <div style={timeInputWrapperStyle}>
                  <select value={form.lunchStart} onChange={e => setForm({ ...form, lunchStart: parseInt(e.target.value) })} style={timeSelectStyle}>
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{formatHour(i)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Hasta</label>
                <div style={timeInputWrapperStyle}>
                  <select value={form.lunchEnd} onChange={e => setForm({ ...form, lunchEnd: parseInt(e.target.value) })} style={timeSelectStyle}>
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{formatHour(i)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sección: Festivos */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <span style={cardIconStyle}>🎉</span>
            <div style={{ flex: 1 }}>
              <h3 style={cardTitleStyle}>Días Festivos</h3>
              <p style={cardSubtitleStyle}>Días en los que la tienda está cerrada</p>
            </div>
            <span style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '0.3rem 0.7rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
              {holidaysList.length} festivo{holidaysList.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="text" placeholder="MM-DD (ej: 01-01)" value={newHoliday}
                onChange={e => setNewHoliday(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addHoliday())}
                style={{ flex: 1, padding: '0.65rem 0.9rem', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '0.85rem', fontFamily: 'var(--font)', color: 'var(--text)' }} />
              <button type="button" onClick={addHoliday}
                style={{ padding: '0.65rem 1.2rem', borderRadius: 'var(--r)', border: 'none', background: 'var(--purple)', color: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                + Agregar
              </button>
              <button type="button" onClick={loadPresetHolidays}
                style={{ padding: '0.65rem 1.2rem', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--purple)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                🇨🇴 Colombia 2026
              </button>
            </div>

            {holidaysList.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: '140px', overflowY: 'auto', padding: '0.5rem', background: 'var(--bg-1)', borderRadius: 'var(--r)' }}>
                {holidaysList.sort().map(h => {
                  const { full } = parseHolidayDate(h);
                  return (
                    <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '0.35rem 0.6rem', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text)' }}>
                      <span style={{ fontWeight: 600 }}>{full}</span>
                      <button type="button" onClick={() => removeHoliday(h)}
                        style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '1rem', padding: 0, lineHeight: 1, fontWeight: 700 }}>×</button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem', background: 'var(--bg-1)', borderRadius: 'var(--r)', color: 'var(--text-3)', fontSize: '0.85rem' }}>
                No hay festivos configurados. Haz clic en "Colombia 2026" para cargar los oficiales.
              </div>
            )}
          </div>
        </div>

        {/* Sección: Mensaje */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <span style={cardIconStyle}>💬</span>
            <div>
              <h3 style={cardTitleStyle}>Mensaje Fuera de Horario</h3>
              <p style={cardSubtitleStyle}>Se envía automáticamente cuando escriben fuera del horario laboral</p>
            </div>
          </div>
          <textarea value={form.autoReplyMessage}
            onChange={e => setForm({ ...form, autoReplyMessage: e.target.value })}
            style={{ width: '100%', padding: '0.85rem', borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: '0.9rem', fontFamily: 'var(--font)', color: 'var(--text)', resize: 'vertical', minHeight: '80px', marginTop: '1rem', lineHeight: 1.5 }}
            placeholder="Hola, estamos fuera de horario. Nuestro horario es Lun-Vie 9AM-6PM. Escríbenos y te atenderemos pronto 😊" />
        </div>

        {/* Botón Guardar */}
        <div style={{ position: 'sticky', bottom: '1.5rem', marginTop: '1rem', zIndex: 10 }}>
          <button type="submit" disabled={saving}
            style={{
              width: '100%', padding: '1rem', borderRadius: 'var(--r-lg)', border: 'none',
              background: saving ? 'var(--text-3)' : 'var(--purple)', color: '#fff',
              fontSize: '0.95rem', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
              boxShadow: '0 4px 15px rgba(83, 16, 110, 0.3)',
              transition: 'all 0.2s',
            }}>
            <IconSave />
            {saving ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>
      </form>
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

const timeInputWrapperStyle = {
  position: 'relative',
};

const timeSelectStyle = {
  width: '100%', padding: '0.75rem 0.9rem', borderRadius: 'var(--r)',
  border: '1px solid var(--border)', background: 'var(--bg-1)',
  fontSize: '0.95rem', fontFamily: 'var(--font)', color: 'var(--text)',
  cursor: 'pointer', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b808c' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center',
};

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSettings, updateSettings } from '../api';
import { IconSave, IconArrowLeft } from '../components/Icons';
import Swal from 'sweetalert2';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const FESTIVOS_2026 = [
  '01-01','01-06','03-23','04-02','04-03','05-01','05-18',
  '06-08','06-15','06-29','07-20','08-07','08-17',
  '10-12','11-02','11-16','12-08','12-25'
];

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
      if (days.length > 1) {
        setForm({ ...form, workingDays: days.filter(d => d !== dayNum).join(',') });
      }
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

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"><IconArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-2xl font-bold text-gray-800">Horario Global del Sistema</h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6 bg-white rounded-xl shadow-sm border p-6">

        {/* Horario */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-3">Horario de Atención</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-500">Hora inicio</label>
              <input type="number" min="0" max="23" value={form.workingHoursStart}
                onChange={e => setForm({ ...form, workingHoursStart: parseInt(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="text-sm text-gray-500">Hora fin</label>
              <input type="number" min="0" max="23" value={form.workingHoursEnd}
                onChange={e => setForm({ ...form, workingHoursEnd: parseInt(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2" />
            </div>
          </div>
        </div>

        {/* Días */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-3">Días de Atención</h3>
          <div className="flex gap-2">
            {[0,1,2,3,4,5,6].map(d => (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={`w-12 h-10 rounded-lg text-sm font-medium transition-colors ${
                  form.workingDays.split(',').map(Number).includes(d)
                    ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>{DIAS[d]}</button>
            ))}
          </div>
        </div>

        {/* Almuerzo */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <input type="checkbox" checked={form.closedForLunch}
              onChange={e => setForm({ ...form, closedForLunch: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded" />
            <h3 className="font-semibold text-gray-700">Cerrado en horario de almuerzo</h3>
          </div>
          {form.closedForLunch && (
            <div className="grid grid-cols-2 gap-4 ml-7">
              <div>
                <label className="text-sm text-gray-500">Almuerzo desde</label>
                <input type="number" min="0" max="23" value={form.lunchStart}
                  onChange={e => setForm({ ...form, lunchStart: parseInt(e.target.value) || 0 })}
                  className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-sm text-gray-500">Almuerzo hasta</label>
                <input type="number" min="0" max="23" value={form.lunchEnd}
                  onChange={e => setForm({ ...form, lunchEnd: parseInt(e.target.value) || 0 })}
                  className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
          )}
        </div>

        {/* Festivos */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">Festivos ({holidaysList.length})</h3>
            <button type="button" onClick={loadPresetHolidays}
              className="text-xs text-blue-600 hover:underline">Cargar Colombia 2026</button>
          </div>
          <div className="flex gap-2 mb-3">
            <input type="text" placeholder="MM-DD" value={newHoliday}
              onChange={e => setNewHoliday(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" maxLength="5" />
            <button type="button" onClick={addHoliday}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Agregar</button>
          </div>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {holidaysList.sort().map(h => (
              <span key={h} className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs flex items-center gap-1">
                {h}
                <button type="button" onClick={() => removeHoliday(h)} className="text-red-400 hover:text-red-600">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Mensaje */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">Mensaje Fuera de Horario</h3>
          <textarea value={form.autoReplyMessage}
            onChange={e => setForm({ ...form, autoReplyMessage: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm" rows="3"
            placeholder="Hola, estamos fuera de horario. Te atenderemos mañana..." />
        </div>

        <button type="submit" disabled={saving}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
          <IconSave className="w-5 h-5" />
          {saving ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      </form>
    </div>
  );
}

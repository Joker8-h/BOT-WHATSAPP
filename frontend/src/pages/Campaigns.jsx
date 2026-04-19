import { useState, useEffect } from 'react';
import { getCampaigns, createCampaign, executeCampaign } from '../api';
import Swal from 'sweetalert2';

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', message: '', city: '', clientType: '', inactive: false, schedule: '' });

  const load = async () => {
    const r = await getCampaigns();
    if (r?.success) setCampaigns(r.data);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const i = setInterval(load, 20000); return () => clearInterval(i); }, []);

  const save = async (e) => {
    e.preventDefault();
    const data = {
      name: form.name,
      message: form.message,
      targetFilter: {},
      scheduledAt: form.schedule || null,
    };
    if (form.city) data.targetFilter.city = form.city;
    if (form.clientType) data.targetFilter.clientType = form.clientType;
    if (form.inactive) data.targetFilter.inactive = true;
    await createCampaign(data);
    setModal(false);
    setForm({ name: '', message: '', city: '', clientType: '', inactive: false, schedule: '' });
    load();
  };

  const execute = async (id) => {
    const result = await Swal.fire({
      title: '¿Ejecutar campaña?',
      text: 'Se enviarán mensajes masivos por WhatsApp a los contactos segmentados.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: 'var(--purple)',
      cancelButtonColor: 'var(--text-3)',
      confirmButtonText: 'Sí, ejecutar ahora',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    const r = await executeCampaign(id);
    if (r?.success) {
      Swal.fire({
        title: 'Campaña Iniciada',
        text: `Se están enviando mensajes a ${r.data.totalTargets} contactos.`,
        icon: 'success'
      });
    }
    load();
  };

  const statusColors = { DRAFT: 'muted', SCHEDULED: 'blue', RUNNING: 'orange', COMPLETED: 'green', CANCELLED: 'red' };

  return (
    <div>
      <h1 className="page-title">Campañas</h1>
      <p className="page-subtitle">Mensajes masivos y reactivación de contactos</p>

      <div className="toolbar">
        <button className="btn-primary" onClick={() => setModal(true)}>Nueva Campaña</button>
      </div>

      <div className="campaigns-grid">
        {campaigns.map(c => (
          <div key={c.id} className="campaign-card">
            <div className="campaign-top">
              <h4>{c.name}</h4>
              <span className={`badge badge-${statusColors[c.status]}`}>{c.status}</span>
            </div>
            <p className="campaign-msg">{c.message.substring(0, 100)}...</p>
            <div className="campaign-stats">
              <div><strong>{c.totalTargets}</strong><span>Objetivo</span></div>
              <div><strong>{c.sentCount}</strong><span>Enviados</span></div>
              <div><strong>{c.responseCount}</strong><span>Respuestas</span></div>
            </div>
            {(c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
              <button className="btn-primary" onClick={() => execute(c.id)}>Ejecutar</button>
            )}
          </div>
        ))}
        {campaigns.length === 0 && <p className="empty">No hay campañas aún</p>}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nueva Campaña</h3>
              <button className="modal-close" onClick={() => setModal(false)}>×</button>
            </div>
            <form onSubmit={save}>
              <div className="form-group"><label>Nombre</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="form-group"><label>Mensaje (usa {'{nombre}'} y {'{ciudad}'})</label>
                <textarea rows={4} required placeholder="¡Hola {nombre}! Tenemos algo especial para ti..."
                  value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} /></div>
              <div className="form-grid">
                <div className="form-group"><label>Ciudad</label>
                  <input placeholder="Todas" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
                <div className="form-group"><label>Tipo cliente</label>
                  <select value={form.clientType} onChange={e => setForm({ ...form, clientType: e.target.value })}>
                    <option value="">Todos</option><option value="NUEVO">Nuevos</option><option value="TIMIDO">Tímidos</option>
                    <option value="EXPLORADOR">Exploradores</option><option value="DECIDIDO">Decididos</option><option value="RECURRENTE">Recurrentes</option>
                  </select></div>
                <div className="form-group"><label>Programar</label>
                  <input type="datetime-local" value={form.schedule} onChange={e => setForm({ ...form, schedule: e.target.value })} /></div>
                <div className="form-group"><label className="checkbox-wrap">
                  <input type="checkbox" checked={form.inactive} onChange={e => setForm({ ...form, inactive: e.target.checked })} /> Solo inactivos (+30 días)</label></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Crear Campaña</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

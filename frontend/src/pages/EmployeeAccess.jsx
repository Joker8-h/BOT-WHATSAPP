import { useState, useEffect, useCallback } from 'react';
import { getEmployees, addEmployee, deleteEmployee } from '../api';
import { IconEmployees, IconPlus, IconTrash, IconSearch, IconUser, IconAlertTriangle } from '../components/Icons';
import Swal from 'sweetalert2';

export default function EmployeeAccess() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ name: '', phone: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getEmployees();
    if (r?.success) setEmployees(r.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const cleanPhone = form.phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      Swal.fire('Error', 'El teléfono debe tener código de país (ej: 57...) y al menos 10 dígitos', 'error');
      return;
    }

    const r = await addEmployee({ ...form, phone: cleanPhone });
    if (r?.success) {
      setModal(false);
      setForm({ name: '', phone: '' });
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Empleado autorizado',
        showConfirmButton: false,
        timer: 2000
      });
      load();
    } else {
      Swal.fire('Error', r?.error || 'No se pudo añadir', 'error');
    }
  };

  const handleDelete = async (id, name) => {
    const result = await Swal.fire({
      title: '¿Eliminar acceso?',
      text: `El empleado "${name}" ya no podrá consultar el bot como personal autorizado.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      const r = await deleteEmployee(id);
      if (r?.success) {
        Swal.fire('Eliminado', 'Acceso revocado correctamente.', 'success');
        load();
      }
    }
  };

  const filtered = employees.filter(e => 
    (e.name?.toLowerCase().includes(filter.toLowerCase())) || 
    (e.phone.includes(filter))
  );

  return (
    <div className="page-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title">Personal Autorizado</h1>
          <p className="page-subtitle">Gestiona quién tiene acceso a las consultas técnicas de inventario vía WhatsApp</p>
        </div>
        <button className="btn-primary" onClick={() => setModal(true)}>
          <IconPlus /> Autorizar Nuevo
        </button>
      </div>

      <div className="toolbar" style={{ marginBottom: '1.5rem' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <span style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}><IconSearch /></span>
          <input type="text" className="search-input" style={{ paddingLeft: '2.2rem' }} placeholder="Buscar por nombre o teléfono..."
            value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="empty">Cargando personal...</div>
      ) : (
        <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {filtered.map(emp => (
            <div key={emp.id} className="card-glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--purple-bg)', color: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconUser />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{emp.name || 'Sin nombre'}</h4>
                    <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>+{emp.phone}</p>
                  </div>
                </div>
                <button className="btn-icon-danger" onClick={() => handleDelete(emp.id, emp.name || emp.phone)}>
                  <IconTrash />
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                Autorizado desde: {new Date(emp.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="empty full-width" style={{ gridColumn: '1 / -1' }}>
              <IconEmployees style={{ fontSize: '3rem', opacity: 0.2, marginBottom: '1rem' }} />
              <p>No hay empleados autorizados registrados.</p>
            </div>
          )}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal small" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Autorizar Nuevo Empleado</h3>
              <button className="modal-close" onClick={() => setModal(false)}>×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: '1.5rem' }}>
              El número debe incluir el código del país (ej: 57 para Colombia).
            </p>
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label>Nombre del Empleado</label>
                <input required placeholder="Ej: Juan Pérez" 
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Número de WhatsApp</label>
                <input required placeholder="Ej: 573001234567" 
                  value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Autorizar Acceso</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { getAllEmployees, getBranches, createEmployee, updateEmployee, deleteEmployeePermanent } from '../api';
import { IconPlus, IconEdit, IconTrash, IconSave, IconClose, IconUser } from '../components/Icons';
import Swal from 'sweetalert2';

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: '', description: '', branchId: '' });

  useEffect(() => {
    loadBranches();
    loadEmployees();
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [filterBranch]);

  const loadBranches = async () => {
    const res = await getBranches();
    if (res?.success) setBranches(res.data);
  };

  const loadEmployees = async () => {
    setLoading(true);
    const res = await getAllEmployees(filterBranch);
    if (res?.success) setEmployees(res.data);
    setLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', role: '', description: '', branchId: branches[0]?.id || '' });
    setShowModal(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({ name: emp.name || '', phone: emp.phone || '', role: emp.role || '', description: emp.description || '', branchId: emp.branchId });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    let res;
    if (editing) {
      res = await updateEmployee(editing.id, form);
    } else {
      res = await createEmployee(form);
    }
    setSaving(false);
    if (res?.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: editing ? 'Empleado actualizado' : 'Empleado creado', showConfirmButton: false, timer: 2000 });
      setShowModal(false);
      loadEmployees();
    } else {
      Swal.fire('Error', res?.error || 'No se pudo guardar', 'error');
    }
  };

  const handleDelete = async (emp) => {
    const result = await Swal.fire({
      title: '¿Eliminar empleado?',
      text: `Se eliminará a ${emp.name || emp.phone}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--red)',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    });
    if (!result.isConfirmed) return;
    const res = await deleteEmployeePermanent(emp.id);
    if (res?.success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Empleado eliminado', showConfirmButton: false, timer: 2000 });
      loadEmployees();
    } else {
      Swal.fire('Error', res?.error || 'No se pudo eliminar', 'error');
    }
  };

  const getBranchName = (branchId) => {
    const b = branches.find(br => br.id === branchId);
    return b ? `${b.name} (${b.city})` : 'Nacional';
  };

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2.5rem' }}>
        <div>
          <h1 className="page-title">Empleados</h1>
          <p className="page-subtitle">Gestión de personal por sede</p>
        </div>
        <button onClick={openCreate} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <IconPlus /> Nuevo Empleado
        </button>
      </header>

      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-3)' }}>Filtrar por sede:</label>
        <select
          value={filterBranch}
          onChange={e => setFilterBranch(e.target.value)}
          style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text)', fontSize: '0.9rem' }}
        >
          <option value="">Todas las sedes</option>
          {branches.map(b => (
            <option key={b.id} value={b.id}>{b.name} ({b.city})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading">Cargando empleados...</div>
      ) : employees.length === 0 ? (
        <div className="empty">
          <IconUser />
          <h3>Sin empleados registrados</h3>
          <p>Aún no hay personal configurado para esta sede.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Cargo</th>
                <th>Funciones</th>
                <th>Sede</th>
                <th className="right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td><strong>{emp.name || '—'}</strong></td>
                  <td>{emp.phone}</td>
                  <td><span className="badge badge-purple">{emp.role || '—'}</span></td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-2)', maxWidth: '250px' }}>{emp.description || '—'}</td>
                  <td>{getBranchName(emp.branchId)}</td>
                  <td className="right">
                    <button onClick={() => openEdit(emp)} className="btn-icon" title="Editar"><IconEdit /></button>
                    <button onClick={() => handleDelete(emp)} className="btn-icon" style={{ color: 'var(--red)' }} title="Eliminar"><IconTrash /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(27,27,28,0.5)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--purple)' }}>{editing ? 'Editar Empleado' : 'Nuevo Empleado'}</h2>
              <button onClick={() => setShowModal(false)} className="btn-icon"><IconClose /></button>
            </div>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label>Nombre completo</label>
                <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ej: Daniela Gomez" />
              </div>
              <div className="form-group">
                <label>Teléfono</label>
                <input required value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="3044401538" />
              </div>
              <div className="form-group">
                <label>Cargo</label>
                <input value={form.role} onChange={e => setForm({...form, role: e.target.value})} placeholder="Ej: Encargada, Asesora, Directora..." />
              </div>
              <div className="form-group">
                <label>Descripción de funciones</label>
                <textarea rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Encargada de entregas, ventas..." />
              </div>
              <div className="form-group">
                <label>Sede</label>
                <select value={form.branchId} onChange={e => setForm({...form, branchId: e.target.value})} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text)', fontSize: '0.95rem' }}>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.city})</option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={saving} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                <IconSave /> {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .form-group label { display: block; font-size: 0.65rem; font-weight: 800; color: var(--text-3); text-transform: uppercase; margin-bottom: 0.4rem; }
        .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-1); font-size: 0.95rem; color: var(--text); font-family: var(--font); resize: vertical; box-sizing: border-box; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--purple); }
        .btn-icon { background: transparent; border: none; color: var(--text-2); cursor: pointer; padding: 0.4rem; border-radius: 6px; transition: all 0.2s; }
        .btn-icon:hover { background: var(--bg-glass); color: var(--text); }
        .badge-purple { background: rgba(139,92,246,0.12); color: var(--purple); }
      `}</style>
    </div>
  );
}

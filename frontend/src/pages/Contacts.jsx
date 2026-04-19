import { useState, useEffect } from 'react';
import { getContacts, timeAgo } from '../api';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = async () => {
    const params = new URLSearchParams({ page, limit: 50 });
    if (search) params.append('search', search);
    if (typeFilter) params.append('clientType', typeFilter);
    const r = await getContacts(params.toString());
    if (r?.success) {
      setContacts(r.data.contacts);
      setTotal(r.data.total);
      setTotalPages(r.data.totalPages);
    }
  };

  useEffect(() => { load(); }, [page, search, typeFilter]);
  useEffect(() => { const i = setInterval(load, 20000); return () => clearInterval(i); }, [page, search, typeFilter]);

  const typeColors = { NUEVO: 'blue', TIMIDO: 'purple', EXPLORADOR: 'green', DECIDIDO: 'gold', RECURRENTE: 'emerald' };

  return (
    <div>
      <h1 className="page-title">Contactos</h1>
      <p className="page-subtitle">{total.toLocaleString()} contactos en la base de datos</p>

      <div className="toolbar">
        <input className="search-input" placeholder="Buscar por nombre o teléfono..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className="filter-select" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
          <option value="">Todos los tipos</option>
          <option value="NUEVO">Nuevos</option>
          <option value="TIMIDO">Tímidos</option>
          <option value="EXPLORADOR">Exploradores</option>
          <option value="DECIDIDO">Decididos</option>
          <option value="RECURRENTE">Recurrentes</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Tipo</th>
              <th>Confianza</th>
              <th>Etapa</th>
              <th>Compras</th>
              <th>Ciudad</th>
              <th>Último msg</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name || '—'}</strong></td>
                <td className="mono">{c.phone}</td>
                <td><span className={`badge badge-${typeColors[c.clientType] || 'blue'}`}>{c.clientType}</span></td>
                <td>{c.confidenceLevel}</td>
                <td>{c.purchaseStage}</td>
                <td className="center">{c.totalPurchases}</td>
                <td>{c.city || '—'}</td>
                <td className="muted">{timeAgo(c.lastMessageAt)}</td>
              </tr>
            ))}
            {contacts.length === 0 && <tr><td colSpan={8} className="empty">No se encontraron contactos</td></tr>}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Anterior</button>
          <span>Página {page} de {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { searchGlobalInventory, formatCOP, CATEGORIES } from '../api';

export default function GlobalInventory() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    const res = await searchGlobalInventory(query);
    if (res?.success) {
      setResults(res.data);
    }
    setLoading(false);
    setSearched(true);
  };

  return (
    <div className="page-container p-6">
      <header className="mb-8">
        <h1 className="page-title" style={{ fontSize: '2.4rem', fontWeight: '800', color: 'var(--purple)' }}>Inventario Global</h1>
        <p className="page-subtitle" style={{ color: 'var(--text-3)', fontSize: '1rem' }}>Localiza productos y stock en cualquier sucursal del país</p>
      </header>

      <div className="card p-8 mb-8" style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <form onSubmit={handleSearch} className="flex gap-4">
          <input 
            type="text" 
            placeholder="Buscar por nombre de producto o descripción..." 
            className="flex-1 input-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={loading} style={{ padding: '0 2rem' }}>
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </form>
      </div>

      {loading && <div className="text-center py-12" style={{ color: 'var(--text-3)' }}>Buscando en la red nacional de Fantasías...</div>}

      {searched && !loading && (
        <div className="fadeIn">
          <h2 className="text-lg font-bold mb-6" style={{ color: 'var(--text)' }}>Resultados Encontrados ({results.length})</h2>
          {results.length === 0 ? (
            <div className="card p-12 text-center" style={{ background: 'var(--bg-0)', border: '1px dashed var(--border)' }}>
              <p style={{ color: 'var(--text-3)' }}>No se encontraron productos con ese nombre en ninguna sucursal.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Sucursal</th>
                    <th>Ciudad</th>
                    <th>Categoría</th>
                    <th className="right">Precio</th>
                    <th className="right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(product => (
                    <tr key={product.id}>
                      <td className="font-bold" style={{ color: 'var(--text)' }}>{product.name}</td>
                      <td>
                        <span style={{ color: 'var(--purple)', fontWeight: '700' }}>{product.branch?.name}</span>
                      </td>
                      <td style={{ color: 'var(--text-2)' }}>{product.branch?.city}</td>
                      <td>
                        <span className="badge badge-purple">
                          {CATEGORIES[product.category] || product.category}
                        </span>
                      </td>
                      <td className="right font-bold">{formatCOP(product.price)}</td>
                      <td className="right">
                        <span className={`badge-stock ${product.stock <= 5 ? 'critical' : 'ok'}`}>
                          {product.stock} und
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .input-field {
          padding: 12px 16px;
          border: 1px solid var(--border);
          background: var(--bg-1);
          border-radius: var(--r);
          outline: none;
          transition: all 0.2s;
          color: var(--text);
        }
        .input-field:focus {
          border-color: var(--purple);
          background: var(--bg-2);
          box-shadow: 0 0 0 4px var(--purple-bg);
        }
        .badge-stock {
          padding: 4px 12px;
          border-radius: 20px;
          font-weight: 800;
          font-size: 0.75rem;
          text-transform: uppercase;
        }
        .badge-stock.critical {
          background: var(--red-bg);
          color: var(--red);
        }
        .badge-stock.ok {
          background: var(--green-bg);
          color: var(--green);
        }
      `}</style>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  getProducts, createProduct, updateProduct, deleteProduct, 
  updateStock, uploadExcel, uploadImage, formatCOP, CATEGORIES 
} from '../api';
import { IconProducts, IconBarChart, IconDollar, IconAlertTriangle, IconUpload, IconPlus, IconEdit, IconTrash, IconSave, IconStar, IconSearch } from '../components/Icons';
import Swal from 'sweetalert2';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [stockModal, setStockModal] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (catFilter) params.append('category', catFilter);
    if (filter) params.append('search', filter);
    const r = await getProducts(params.toString());
    if (r?.success) setProducts(r.data);
  }, [filter, catFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      Swal.fire('Formato no válido', 'Solo se permiten archivos .xlsx, .xls o .csv', 'warning');
      return;
    }
    setUploading(true);
    setUploadResult(null);
    const r = await uploadExcel(file);
    setUploading(false);
    if (r?.success) { 
      Swal.fire('Importación Exitosa', `${r.data.imported} productos procesados correctamente.`, 'success');
      setUploadResult(r.data); 
      load(); 
    }
    else { 
      Swal.fire('Error en Importación', r?.error || 'No se pudo procesar el archivo', 'error');
      setUploadResult({ error: r?.error || 'Error desconocido' }); 
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const [form, setForm] = useState({
    name: '', description: '', price: '', category: 'CONEXION_PAREJA',
    stock: '10', emotionalDesc: '', isFeatured: false, imageUrl: '',
  });

  const openModal = (product = null) => {
    if (product) {
      setForm({
        name: product.name, description: product.description || '',
        price: String(product.price), category: product.category,
        stock: String(product.stock), emotionalDesc: product.emotionalDesc || '',
        isFeatured: product.isFeatured, imageUrl: product.imageUrl || '',
      });
      setModal(product);
    } else {
      setForm({ name: '', description: '', price: '', category: 'CONEXION_PAREJA', stock: '10', emotionalDesc: '', isFeatured: false, imageUrl: '' });
      setModal('new');
    }
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    const data = { ...form, price: parseFloat(form.price), stock: parseInt(form.stock) };
    if (modal === 'new') await createProduct(data);
    else await updateProduct(modal.id, data);
    setModal(null);
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Catálogo actualizado',
      showConfirmButton: false,
      timer: 2000
    });
    load();
  };

  const handleToggleAvailability = async (id, name, currentlyAvailable) => {
    const action = currentlyAvailable ? 'desactivar' : 'activar';
    const result = await Swal.fire({
      title: `¿Confirmar ${action}?`,
      text: currentlyAvailable 
        ? `El producto "${name}" se marcará como no disponible y el bot no lo ofrecerá.` 
        : `El producto "${name}" volverá a estar disponible para la venta.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: currentlyAvailable ? '#dc3545' : '#28a745',
      cancelButtonColor: 'var(--text-3)',
      confirmButtonText: `Sí, ${action}`,
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      if (currentlyAvailable) {
        await deleteProduct(id); // Backend sets isAvailable: false
      } else {
        await updateProduct(id, { isAvailable: true });
      }
      Swal.fire(currentlyAvailable ? 'Desactivado' : 'Activado', `El producto ha sido ${currentlyAvailable ? 'desactivado' : 'activado'}.`, 'success');
      load();
    }
  };

  const [stockForm, setStockForm] = useState({ stock: '', reason: '' });

  const openStockModal = (product) => {
    setStockForm({ stock: String(product.stock), reason: '' });
    setStockModal(product);
  };

  const saveStock = async (e) => {
    e.preventDefault();
    await updateStock(stockModal.id, { stock: parseInt(stockForm.stock), reason: stockForm.reason });
    setStockModal(null);
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Stock actualizado',
      showConfirmButton: false,
      timer: 2000
    });
    load();
  };

  const totalProducts = products.length;
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const totalValue = products.reduce((s, p) => s + Number(p.price) * p.stock, 0);
  const lowStock = products.filter(p => p.stock <= 5).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="page-title">Catálogo de Productos</h1>
          <p className="page-subtitle">Gestión de inventario y optimización de ventas</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
           <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
              <IconUpload /> {uploading ? 'Procesando...' : 'Importar Excel'}
           </button>
           <button className="btn-primary" onClick={() => openModal()}>
              <IconPlus /> Nuevo Producto
           </button>
        </div>
      </div>

      <div className="metrics-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="metric-card accent-purple">
          <div className="metric-icon-wrap"><IconProducts /></div>
          <div><span className="metric-value">{totalProducts}</span><span className="metric-label">Productos</span></div>
        </div>
        <div className="metric-card accent-blue">
          <div className="metric-icon-wrap"><IconBarChart /></div>
          <div><span className="metric-value">{totalStock}</span><span className="metric-label">Unidades Totales</span></div>
        </div>
        <div className="metric-card accent-green">
          <div className="metric-icon-wrap"><IconDollar /></div>
          <div><span className="metric-value">{formatCOP(totalValue)}</span><span className="metric-label">Valor Inventario</span></div>
        </div>
        <div className="metric-card accent-gold">
          <div className="metric-icon-wrap"><IconAlertTriangle /></div>
          <div><span className="metric-value" style={{ color: lowStock > 0 ? 'var(--red)' : 'inherit' }}>{lowStock}</span><span className="metric-label">Stock Crítico</span></div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files[0])} />

      {!uploadResult && !uploading && products.length === 0 && (
        <div className={`excel-upload ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}>
          <div style={{ marginBottom: '0.8rem' }}><IconUpload /></div>
          <p style={{ fontWeight: 'bold', color: 'var(--text)' }}>Tu inventario está vacío</p>
          <p style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>Arrastra tu archivo Excel aquí o utiliza el botón de importación</p>
        </div>
      )}

      {uploadResult && (
        <div className={`upload-result ${uploadResult.error ? 'error' : 'success'}`}>
          {uploadResult.error ? (
            <p>{uploadResult.error}</p>
          ) : (
            <>
              <p><strong>{uploadResult.imported}</strong> productos importados de {uploadResult.totalRows} filas</p>
              {uploadResult.columns && (<p className="upload-columns">Columnas detectadas: {uploadResult.columns.join(', ')}</p>)}
              {uploadResult.errors?.length > 0 && (
                <details><summary>{uploadResult.errors.length} errores</summary>
                <ul>{uploadResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
              )}
            </>
          )}
          <button className="btn-dismiss" onClick={() => setUploadResult(null)}>×</button>
        </div>
      )}

      <div className="toolbar">
        <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
          <span style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}><IconSearch /></span>
          <input type="text" className="search-input" style={{ paddingLeft: '2.2rem' }} placeholder="Buscar productos..."
            value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <select className="filter-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">Todas las categorías</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="products-grid">
        {products.map(p => (
          <div key={p.id} className={`product-card ${p.isFeatured ? 'featured' : ''} ${p.isAvailable === false ? 'deactivated' : ''} ${p.stock === 0 ? 'out-of-stock' : p.stock <= 5 ? 'low-stock' : ''}`}>
             <div className="product-image-container">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="product-thumb" />
              ) : (
                <div className="product-thumb-placeholder">
                  <IconProducts />
                </div>
              )}
            </div>
            <div className="product-card-body">
              <span className="prod-category">{CATEGORIES[p.category] || p.category}</span>
              <h4 className="prod-name">{p.name}</h4>
              {p.branch && (
                <div style={{ fontSize: '0.7rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--purple)' }}>
                  {p.branch.city} · {p.branch.name}
                </div>
              )}
              <p className="prod-desc">{p.description || p.emotionalDesc || ''}</p>
              <div className="prod-price">{formatCOP(p.price)}</div>
              <div className="prod-stock-row">
                <span className={`stock-indicator ${p.stock === 0 ? 'red' : p.stock <= 5 ? 'orange' : 'green'}`}>
                  Stock: {p.stock}
                </span>
                {p._count?.orderItems > 0 && (
                  <span className="sold-count">{p._count.orderItems} vendidos</span>
                )}
              </div>
              <div className="prod-actions">
                <button onClick={() => openStockModal(p)} title="Ajustar stock"><IconBarChart /></button>
                <button onClick={() => openModal(p)} title="Editar"><IconEdit /></button>
                {p.isAvailable !== false ? (
                  <button className="btn-danger" onClick={() => handleToggleAvailability(p.id, p.name, true)} title="Desactivar"><IconTrash /></button>
                ) : (
                  <button className="btn-success" onClick={() => handleToggleAvailability(p.id, p.name, false)} title="Activar" style={{ background: '#28a745', color: 'white' }}><IconPlus /></button>
                )}
              </div>
            </div>
          </div>
        ))}
        {products.length === 0 && <p className="empty full-width">No hay productos. Importa tu Excel o crea uno manualmente.</p>}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Nuevo Producto' : `Editar: ${modal.name}`}</h3>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <form onSubmit={saveProduct}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Nombre *</label>
                  <input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Precio (COP) *</label>
                  <input type="number" required min="1" max="50000000" step="100"
                    value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Categoría *</label>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Stock</label>
                  <input type="number" min="0" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
                </div>
                <div className="form-group span-2">
                  <label>Descripción</label>
                  <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="form-group span-2">
                  <label>Descripción emocional (la IA usará esto para vender)</label>
                  <textarea rows={3} placeholder="Ej: Perfecto para reconectar con tu pareja en una noche especial..."
                    value={form.emotionalDesc} onChange={e => setForm({ ...form, emotionalDesc: e.target.value })} />
                </div>
                <div className="form-group span-2">
                  <label>Imagen del Producto</label>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.5rem' }}>
                    <div style={{ width: '80px', height: '80px', borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {form.imageUrl ? (
                        <img src={form.imageUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <IconProducts style={{ opacity: 0.2 }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} id="prod-img-upload" 
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          
                          try {
                            setUploading(true);
                            const r = await uploadImage(file);
                            setUploading(false);
                            
                            if (r?.success) {
                              setForm({ ...form, imageUrl: r.url });
                              Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Imagen subida', showConfirmButton: false, timer: 1500 });
                            } else {
                              Swal.fire('Error', r?.error || 'No se pudo subir la imagen', 'error');
                            }
                          } catch (err) {
                            setUploading(false);
                            console.error('Upload Error:', err);
                            Swal.fire('Error', err.message || 'Error de conexión', 'error');
                          }
                        }} />
                      <label htmlFor="prod-img-upload" className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', width: 'auto' }}>
                        <IconUpload /> {uploading ? 'Subiendo...' : 'Subir Imagen'}
                      </label>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: '0.5rem' }}>
                        Se recomienda formato cuadrado (500x500px)
                      </p>
                    </div>
                  </div>
                  <input style={{ marginTop: '0.5rem' }} placeholder="O pega la URL aquí..."
                    value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="checkbox-wrap">
                    <input type="checkbox" checked={form.isFeatured}
                      onChange={e => setForm({ ...form, isFeatured: e.target.checked })} />
                    Producto Estrella
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={uploading}><IconSave /> Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {stockModal && (
        <div className="modal-overlay" onClick={() => setStockModal(null)}>
          <div className="modal small" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Ajustar Stock: {stockModal.name}</h3>
              <button className="modal-close" onClick={() => setStockModal(null)}>×</button>
            </div>
            <form onSubmit={saveStock}>
              <div className="stock-current">
                Stock actual: <strong>{stockModal.stock}</strong> unidades
              </div>
              <div className="form-group">
                <label>Nuevo stock</label>
                <input type="number" min="0" required value={stockForm.stock}
                  onChange={e => setStockForm({ ...stockForm, stock: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Razón del ajuste</label>
                <input placeholder="Ej: Llegó inventario nuevo, corrección manual..."
                  value={stockForm.reason} onChange={e => setStockForm({ ...stockForm, reason: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setStockModal(null)}>Cancelar</button>
                <button type="submit" className="btn-primary"><IconSave /> Actualizar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

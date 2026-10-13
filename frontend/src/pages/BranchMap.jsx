import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getBranches, formatCOP } from '../api';
import L from 'leaflet';

// Fix for default marker icons in Leaflet + React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

const isValidCoord = (lat, lng) => {
  const la = parseFloat(lat); const ln = parseFloat(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
};

export default function BranchMap() {
  const [branches, setBranches] = useState([]);
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await getBranches();
      if (res?.success) {
          const all = Array.isArray(res.data) ? res.data : [];
          // Solo activas y autorizadas en el mapa; el resto se lista como pendientes
          const active = all.filter(b => b.isActive && b.isAuthorized);
          setBranches(active.filter(b => isValidCoord(b.latitude, b.longitude)));
          setMissing(all.filter(b => !isValidCoord(b.latitude, b.longitude)));
      }
      setLoading(false);
    };
    load();
  }, []);

  const colombiaCenter = [4.5709, -74.2973];

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando mapa de sedes...</div>;

  return (
    <div className="page-container p-6">
      <div className="mb-6">
        <h1 className="page-title" style={{ fontSize: '2.4rem', fontWeight: '800', color: 'var(--purple)' }}>Mapa de Sedes</h1>
        <p className="page-subtitle" style={{ color: 'var(--text-3)', fontSize: '1rem' }}>Vista general de la red nacional de sucursales Fantasías</p>
      </div>

      <div className="rounded-2xl overflow-hidden shadow-xl border border-white mt-4" style={{ height: '500px', background: 'var(--bg-2)' }}>
        {branches.length === 0 && !loading ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--text-3)', padding: '2rem', textAlign: 'center' }}>
            <span style={{ fontSize: '2rem' }}>🗺️</span>
            <p style={{ fontWeight: '800', color: 'var(--text-2)' }}>Ninguna sede tiene coordenadas todavía</p>
            <p style={{ fontSize: '0.85rem' }}>Agrega latitud/longitud en la configuración de cada sede para verla aquí.</p>
          </div>
        ) : (
        <MapContainer center={colombiaCenter} zoom={6} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {branches.map(branch => (
            <Marker key={branch.id} position={[parseFloat(branch.latitude), parseFloat(branch.longitude)]} icon={DefaultIcon}>
              <Popup>
                <div className="p-1" style={{ width: '200px' }}>
                    <h3 style={{ margin: '0 0 5px 0', color: 'var(--purple)', fontWeight: 'bold' }}>{branch.name}</h3>
                    <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem', color: 'var(--text-2)' }}>{branch.city}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                        <div>
                            <span style={{ display: 'block', color: 'var(--text-3)' }}>Inventario</span>
                            <span style={{ fontWeight: 'bold' }}>{branch._count?.products || 0} pzs</span>
                        </div>
                        <div>
                            <span style={{ display: 'block', color: 'var(--text-3)' }}>Ventas</span>
                            <span style={{ fontWeight: 'bold' }}>{branch._count?.orders || 0}</span>
                        </div>
                    </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        )}
      </div>

      {missing.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem', borderLeft: '3px solid var(--gold)' }}>
          <div className="card-title">📍 {missing.length} sede(s) sin coordenadas</div>
          <div className="card-body">
            <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: '0.75rem' }}>
              Estas sedes no aparecen en el mapa. Edita cada sede y agrega latitud (-90 a 90) y longitud (-180 a 180).
            </p>
            <ul style={{ fontSize: '0.85rem', color: 'var(--text-2)', paddingLeft: '1.2rem', margin: 0 }}>
              {missing.map(b => <li key={b.id}>{b.name} · {b.city}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="metric-card accent-purple">
              <div className="flex flex-col">
                  <span className="text-3xl mb-2">🏪</span>
                  <span className="text-2xl font-bold" style={{ color: 'var(--purple)' }}>{branches.length}</span>
                  <span className="text-xs text-uppercase font-bold" style={{ color: 'var(--text-3)', letterSpacing: '1px' }}>Sedes Activas</span>
              </div>
          </div>
          <div className="metric-card accent-blue">
              <div className="flex flex-col">
                  <span className="text-3xl mb-2"></span>
                  <span className="text-2xl font-bold">{branches.reduce((acc, b) => acc + (b._count?.products || 0), 0)}</span>
                  <span className="text-xs text-uppercase font-bold" style={{ color: 'var(--text-3)', letterSpacing: '1px' }}>Stock en Red</span>
              </div>
          </div>
          <div className="metric-card accent-green">
              <div className="flex flex-col">
                  <span className="text-3xl mb-2">🇨🇴</span>
                  <span className="text-2xl font-bold">Nacional</span>
                  <span className="text-xs text-uppercase font-bold" style={{ color: 'var(--text-3)', letterSpacing: '1px' }}>Cobertura Total</span>
              </div>
          </div>
      </div>
    </div>
  );
}

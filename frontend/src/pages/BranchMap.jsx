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

L.Marker.prototype.options.icon = DefaultIcon;

export default function BranchMap() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await getBranches();
      if (res?.success) {
          // Filtrar sucursales que tienen coordenadas
          setBranches(res.data.filter(b => b.latitude && b.longitude));
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
        <MapContainer center={colombiaCenter} zoom={6} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {branches.map(branch => (
            <Marker key={branch.id} position={[branch.latitude, branch.longitude]}>
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
      </div>

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

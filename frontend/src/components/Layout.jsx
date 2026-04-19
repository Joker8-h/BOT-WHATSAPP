import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { getWhatsAppStatus } from '../api';
import { useAuth } from '../context/AuthContext';
import {
  IconDashboard, IconProducts, IconContacts, IconChat,
  IconOrders, IconCampaigns, IconSettings, IconBranches,
  IconMap, IconGlobe, IconLogout, IconMenu, IconChevronLeft,
  IconEmployees
} from './Icons';

export default function Layout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [waStatus, setWaStatus] = useState(false);
  const [time, setTime] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      const res = await getWhatsAppStatus();
      if (res?.success) setWaStatus(res.data.isReady);
    };
    checkStatus();
    const statusInterval = setInterval(checkStatus, 15000);
    const tInterval = setInterval(() => {
      setTime(new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => { clearInterval(statusInterval); clearInterval(tInterval); };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', icon: <IconDashboard />, label: 'Dashboard', end: true },
    { path: '/products', icon: <IconProducts />, label: 'Productos' },
    { path: '/contacts', icon: <IconContacts />, label: 'Contactos' },
    { path: '/conversations', icon: <IconChat />, label: 'Chats' },
    { path: '/orders', icon: <IconOrders />, label: 'Pedidos' },
    { path: '/employee-access', icon: <IconEmployees />, label: 'Empleados Acceso' },
    { path: '/campaigns', icon: <IconCampaigns />, label: 'Campañas' },
    { path: '/settings', icon: <IconSettings />, label: 'Configuración' },
  ];

  const adminItems = [
    { path: '/branches/management', icon: <IconBranches />, label: 'Gestión de Sedes' },
    { path: '/branches/map', icon: <IconMap />, label: 'Mapa de Sedes' },
    { path: '/inventory/global', icon: <IconGlobe />, label: 'Stock Global' },
  ];

  return (
    <div className="app-layout">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
            <img src="/logo.png" alt="Fantasías" className="logo-img" />
            <h2 className="logo-text">Fantasías</h2>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">PRINCIPAL</div>
          {navItems.map(item => (
            <NavLink key={item.path} to={item.path} end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}

          {user?.role === 'ADMIN' && (
            <>
              <div className="nav-section-label" style={{ marginTop: '1.8rem' }}>INFRAESTRUCTURA</div>
              {adminItems.map(item => (
                <NavLink key={item.path} to={item.path}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className={`status-dot ${waStatus ? 'online' : ''}`}></span>
            <span className="status-text">{waStatus ? 'WhatsApp activo' : 'WhatsApp inactivo'}</span>
          </div>
          <div className="user-info-side">
            <p className="user-name">{user?.username}</p>
            <p className="user-branch">{user?.branchName || user?.branch?.city || 'Administrador'}</p>
          </div>
          <button className="btn-logout" onClick={handleLogout}>
            <IconLogout /> Cerrar sesión
          </button>
        </div>
      </aside>

      <main className={`main-content ${collapsed ? 'expanded' : ''}`}>
        <header className="top-header">
          <button 
            onClick={() => setCollapsed(!collapsed)} 
            className="btn-toggle"
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          >
            {collapsed ? <IconMenu /> : <IconChevronLeft />}
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div className="header-branch-info">
              {user?.branchName || user?.branch?.name || 'Panel de Control'}
            </div>
            <div className="header-time">{time}</div>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>

      <style>{`
        .nav-section-label {
          font-size: 0.6rem;
          color: var(--text-3);
          font-weight: 800;
          letter-spacing: 1.5px;
          margin: 1.5rem 0.5rem 0.5rem;
          padding-left: 0.75rem;
          text-transform: uppercase;
        }
        .user-info-side {
          padding: 0.8rem 0.75rem;
        }
        .user-name {
          font-weight: 700;
          font-size: 0.88rem;
          color: var(--text);
        }
        .user-branch {
          font-size: 0.72rem;
          color: var(--purple);
          font-weight: 600;
        }
        .header-branch-info {
          font-weight: 600;
          color: var(--text-2);
          font-size: 0.88rem;
        }
        .sidebar-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.6rem 0.75rem;
          border-top: 1px solid var(--border);
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-3);
          flex-shrink: 0;
        }
        .status-dot.online {
          background: var(--green);
          box-shadow: 0 0 6px rgba(45,138,92,0.4);
        }
        .status-text {
          font-size: 0.7rem;
          color: var(--text-3);
          font-weight: 600;
        }
        .btn-logout {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: calc(100% - 1.5rem);
          margin: 0 0.75rem 0.75rem;
          padding: 0.6rem 0.75rem;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: var(--r);
          color: var(--text-2);
          font-family: var(--font);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn-logout:hover {
          background: rgba(220,38,38,0.06);
          border-color: rgba(220,38,38,0.2);
          color: var(--red);
        }
      `}</style>
    </div>
  );
}

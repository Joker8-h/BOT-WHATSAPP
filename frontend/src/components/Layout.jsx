import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { getWhatsAppStatus } from '../api';
import { useAuth } from '../context/AuthContext';
import TourGuide from './TourGuide';
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
    { path: '/', icon: <IconDashboard />, label: 'Dashboard', end: true, tour: 'nav-dashboard' },
    { path: '/products', icon: <IconProducts />, label: 'Productos', tour: 'nav-products' },
    { path: '/contacts', icon: <IconContacts />, label: 'Contactos', tour: 'nav-contacts' },
    { path: '/conversations', icon: <IconChat />, label: 'Chats', tour: 'nav-chats' },
    { path: '/orders', icon: <IconOrders />, label: 'Pedidos', tour: 'nav-orders' },
    { path: '/employee-access', icon: <IconEmployees />, label: 'Empleados Acceso', tour: 'nav-employee-access' },
    { path: '/campaigns', icon: <IconCampaigns />, label: 'Campañas', tour: 'nav-campaigns' },
    { path: '/settings', icon: <IconSettings />, label: 'Configuración', tour: 'nav-settings' },
  ];

  const adminItems = [
    { path: '/branches/management', icon: <IconBranches />, label: 'Gestión de Sedes', tour: 'nav-branch-management' },
    { path: '/branches/map', icon: <IconMap />, label: 'Mapa de Sedes', tour: 'nav-branch-map' },
    { path: '/employees', icon: <IconEmployees />, label: 'Empleados', tour: 'nav-employees' },
    { path: '/inventory/global', icon: <IconGlobe />, label: 'Stock Global', tour: 'nav-global-inventory' },
    { path: '/system-settings', icon: <IconSettings />, label: 'Horario Global', tour: 'nav-system-settings' },
  ];

  return (
    <>
      <TourGuide />
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
              data-tour={item.tour}
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
                  data-tour={item.tour}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status" data-tour="whatsapp-status">
            <span className={`status-dot ${waStatus ? 'online' : ''}`}></span>
            <span className="status-text">{waStatus ? 'WhatsApp activo' : 'WhatsApp inactivo'}</span>
          </div>
          <div className="user-info-side">
            <p className="user-name">{user?.username}</p>
            <p className="user-branch">{user?.branchName || user?.branch?.city || 'Administrador'}</p>
          </div>
          <button className="btn-logout" onClick={handleLogout} data-tour="logout-btn">
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

        <button className="fab-help" onClick={() => window.__restartTour?.()} title="Reiniciar tour guiado">
          🎓
        </button>
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
        .btn-restart-tour {
          background: none;
          border: 1px dashed rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.35);
          padding: 0.35rem 0.7rem;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.7rem;
          margin: 0 0.75rem 0.75rem;
          font-family: var(--font);
          transition: all 0.2s;
          width: calc(100% - 1.5rem);
        }
        .btn-restart-tour:hover {
          border-color: rgba(255,255,255,0.4);
          color: rgba(255,255,255,0.7);
        }
        .fab-help {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #e91e63, #9c27b0);
          color: white;
          border: none;
          font-size: 1.3rem;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(233,30,99,0.4);
          z-index: 9999;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fab-help:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 20px rgba(233,30,99,0.6);
        }
      `}</style>
      </div>
    </>
  );
}

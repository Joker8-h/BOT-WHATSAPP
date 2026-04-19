import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Contacts from './pages/Contacts';
import Conversations from './pages/Conversations';
import Orders from './pages/Orders';
import Campaigns from './pages/Campaigns';
import Settings from './pages/Settings';
import BranchManagement from './pages/BranchManagement';
import BranchMap from './pages/BranchMap';
import GlobalInventory from './pages/GlobalInventory';
import EmployeeAccess from './pages/EmployeeAccess';

/**
 * Componente para proteger rutas privadas
 */
function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  
  if (loading) return <div className="loading-screen">Cargando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  
  return children;
}

function AppContent() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* Rutas Protegidas */}
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="branches/management" element={<ProtectedRoute adminOnly><BranchManagement /></ProtectedRoute>} />
        <Route path="branches/map" element={<ProtectedRoute adminOnly><BranchMap /></ProtectedRoute>} />
        <Route path="inventory/global" element={<ProtectedRoute adminOnly><GlobalInventory /></ProtectedRoute>} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="orders" element={<Orders />} />
        <Route path="employee-access" element={<EmployeeAccess />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="settings" element={<Settings />} />
        
        <Route path="global-inventory" element={
          <ProtectedRoute adminOnly>
            <GlobalInventory />
          </ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}

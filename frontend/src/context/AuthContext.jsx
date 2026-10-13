import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('fantasias_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      // Intentar recuperar perfil del usuario si hay token
      fetchProfile();
    } else {
      setLoading(false);
    }
  }, [token]);

  const fetchProfile = async () => {
    try {
      // Misma base única que api.js (con o sin /api)
      const rawBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
      const base = !rawBase ? '/api' : (rawBase.endsWith('/api') ? rawBase : `${rawBase}/api`);
      const response = await fetch(`${base}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.status === 401 || response.status === 403) {
        logout();
        return;
      }
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
      } else {
        // Error transitorio (500) no desloguea: se reintenta en el próximo ciclo
        console.warn('Perfil no disponible, se reintentará:', data.error);
        setLoading(false);
        return;
      }
    } catch (error) {
      // Caída de red: no desloguear, solo marcar no-cargado
      console.error('Error fetching profile (red):', error);
    } finally {
      setLoading(false);
    }
  };

  const login = (newToken, userData) => {
    localStorage.setItem('fantasias_token', newToken);
    setToken(newToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('fantasias_token');
    setToken(null);
    setUser(null);
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    isAdmin: user?.role === 'ADMIN',
    isAuthenticated: !!user
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};

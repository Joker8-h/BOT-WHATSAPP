import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginUser } from '../api';
import { useAuth } from '../context/AuthContext';
import Swal from 'sweetalert2';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
        const res = await loginUser(username, password);
        if (res?.success) {
          login(res.data.token, res.data.user);
          navigate('/');
        } else {
          Swal.fire({
            title: 'Error de Acceso',
            text: res?.error || 'Credenciales inválidas',
            icon: 'error',
            confirmButtonColor: 'var(--purple)'
          });
        }
    } catch (err) {
        setError('Error al conectar con el servidor');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="Logo" className="logo-img-xl" />
          <h1>Fantasías</h1>
          <p>Panel de Control Nacional</p>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nombre de Usuario</label>
            <input 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)}
              placeholder="Ej: sucursal_bogota" 
              required 
              autoComplete="username" 
            />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" 
              required 
              autoComplete="current-password" 
            />
          </div>
          
          {error && <p className="error-text" style={{ color: 'var(--red)', fontSize: '0.9rem', marginBottom: '1rem' }}>{error}</p>}
          
          <button type="submit" className="btn-primary full" disabled={loading}>
            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="login-footer" style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-3)' }}>
          <p>© 2026 Fantasías — Gestión de Sucursales</p>
        </div>
      </div>
    </div>
  );
}

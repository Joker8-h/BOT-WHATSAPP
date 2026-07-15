import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Joyride, ACTIONS, STATUS } from 'react-joyride';
import { useAuth } from '../context/AuthContext';

const TOUR_KEY = 'fantasias_tour_completed';

const ALL_CHAPTERS = [
  {
    path: '/',
    steps: [
      {
        target: 'h1.page-title',
        content: '👋 Bienvenido al panel de control. Aquí ves un resumen rápido de todo tu negocio.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.metrics-grid',
        content: '📊 Estas tarjetas muestran indicadores clave: estado de WhatsApp, contactos activos, chats del día y ventas de hoy.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card:first-child',
        content: '🛒 Aquí aparecen los productos más vendidos del día con sus cantidades e ingresos.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card:nth-child(2)',
        content: '⚠️ Alertas de inventario: productos con stock bajo o agotado que requieren atención.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card.full-width',
        content: '📋 Últimas transacciones del día: clientes que han comprado, montos y horarios.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/products',
    steps: [
      {
        target: 'h1.page-title',
        content: '📦 Catálogo de productos. Aquí administras todo tu inventario: precios, stock e imágenes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: '🔍 Barra de herramientas: busca productos, filtra por categoría, importa desde Excel o crea un producto nuevo.',
        placement: 'bottom',
      },
      {
        target: '.products-grid',
        content: '🃏 Cada tarjeta es un producto con su imagen, nombre, precio, stock disponible y acciones. Los productos con stock bajo se marcan en rojo.',
        placement: 'top',
      },
      {
        target: '.prod-actions',
        content: '✏️ Desde aquí puedes editar, ajustar stock, activar/desactivar o eliminar cada producto.',
        placement: 'left',
      },
    ],
  },
  {
    path: '/contacts',
    steps: [
      {
        target: 'h1.page-title',
        content: '👥 Tus contactos. Clientes que han escrito al negocio desde WhatsApp.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: '🔎 Busca contactos por nombre o teléfono, y filtra por tipo de cliente (todos, nuevos, recurrentes, VIP).',
        placement: 'bottom',
      },
      {
        target: '.data-table',
        content: '📋 Tabla completa con nombre, teléfono, tipo de cliente, nivel de confianza, etapa de compra, ciudad y última interacción.',
        placement: 'top',
      },
      {
        target: '.pagination',
        content: '📄 Navega entre páginas para ver todos tus contactos.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/conversations',
    steps: [
      {
        target: 'h1.page-title',
        content: '💬 Conversaciones de WhatsApp. El corazón del sistema: aquí chateas con tus clientes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.chat-list',
        content: '📱 Lista de conversaciones activas. Cada una muestra el nombre del cliente, el último mensaje, la hora y si tiene mensajes sin leer.',
        placement: 'right',
      },
      {
        target: '.chat-panel',
        content: '💭 Al seleccionar una conversación, ves el historial completo de mensajes y puedes responder directamente.',
        placement: 'left',
      },
      {
        target: '.chat-input',
        content: '⌨️ Escribe tu respuesta aquí y presiona Enviar. El mensaje llegará al cliente por WhatsApp.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/orders',
    steps: [
      {
        target: 'h1.page-title',
        content: '📋 Gestión de pedidos. Aquí ves y administras todas las órdenes recibidas.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.mini-metrics',
        content: '💰 Resumen rápido: pedidos pagados, total cobrado, enviados y pendientes.',
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: '🔽 Filtra pedidos por estado: Pendiente, Pagado, Enviado, Entregado, Cancelado.',
        placement: 'bottom',
      },
      {
        target: '.data-table',
        content: '📊 Tabla de pedidos con cliente, productos, ciudad, monto, estado y fecha. Puedes cambiar el estado de cada pedido directamente desde aquí.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/employee-access',
    steps: [
      {
        target: 'h1.page-title',
        content: '🔐 Personal autorizado para usar el WhatsApp de la sede.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: '➕ Botón "Autorizar Nuevo" para agregar empleados que puedan atender WhatsApp desde el panel.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid',
        content: '👤 Cada tarjeta muestra un empleado autorizado: nombre, teléfono y fecha de autorización.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/campaigns',
    steps: [
      {
        target: 'h1.page-title',
        content: '📢 Campañas de marketing automatizadas. Envía mensajes masivos a tus clientes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: '➕ Crea una nueva campaña: define el mensaje y selecciona los destinatarios.',
        placement: 'bottom',
      },
      {
        target: '.campaigns-grid',
        content: '📊 Cada campaña muestra el mensaje, estado (activa/inactiva), estadísticas de envío y botón para ejecutar.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/settings',
    steps: [
      {
        target: 'h1.page-title',
        content: '⚙️ Configuración general del sistema.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.settings-grid .card:first-child',
        content: '📱 Conexión WhatsApp: aquí ves el código QR para conectar tu número, el estado actual y puedes desvincular la sesión.',
        placement: 'bottom',
      },
      {
        target: '.settings-grid .card:nth-child(2)',
        content: '💳 Configuración de Wompi (pasarela de pagos): credenciales para recibir pagos con Nequi, Daviplata y tarjetas.',
        placement: 'bottom',
      },
      {
        target: '.settings-grid .card:last-child',
        content: '🔄 Sincronización con Google Drive: aquí agregas fuentes para importar tu catálogo desde Excel.',
        placement: 'top',
      },
    ],
  },
];

const ADMIN_CHAPTERS = [
  {
    path: '/branches/management',
    steps: [
      {
        target: 'h1.page-title',
        content: '🏪 Gestión de sedes. Administra todas las sucursales del negocio.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.table-wrap',
        content: '📋 Tabla de sedes con nombre, ciudad, estado, empleados asignados y acciones para editar o desactivar.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/branches/map',
    steps: [
      {
        target: 'h1.page-title',
        content: '🗺️ Mapa de sedes. Visualiza todas tus sucursales en un mapa interactivo.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.leaflet-container',
        content: '📍 Cada marcador representa una sede. Haz clic para ver información de la sucursal.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/employees',
    steps: [
      {
        target: 'h1.page-title',
        content: '👥 Empleados del sistema. Gestiona quién tiene acceso al panel administrativo.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.table-wrap',
        content: '📋 Lista de empleados con usuario, nombre, sede, rol y acciones.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/inventory/global',
    steps: [
      {
        target: 'h1.page-title',
        content: '🌐 Stock global. Consulta el inventario de todas las sedes en un solo lugar.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.search-input',
        content: '🔍 Busca productos por nombre en todas las sedes simultáneamente.',
        placement: 'bottom',
      },
      {
        target: '.products-grid',
        content: '📊 Cada producto muestra el stock disponible por sede, permitiendo comparar inventarios.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/system-settings',
    steps: [
      {
        target: 'h1.page-title',
        content: '⚙️ Horario global. Configura el horario de atención para todo el sistema.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.settings-grid',
        content: '🕐 Define horarios de apertura, cierre y almuerzo que aplican a todas las sedes. El bot respeta estos horarios para responder automáticamente.',
        placement: 'top',
      },
    ],
  },
];

export default function TourGuide() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const chapters = isAdmin ? [...ALL_CHAPTERS, ...ADMIN_CHAPTERS] : ALL_CHAPTERS;

  const [chapterIdx, setChapterIdx] = useState(-1);
  const [run, setRun] = useState(false);
  const [currentSteps, setCurrentSteps] = useState([]);
  const [restartKey, setRestartKey] = useState(0);
  const chapterRef = useRef(-1);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_KEY);
    if (!completed) {
      const t = setTimeout(() => setChapterIdx(0), 500);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (chapterIdx === -1 || chapterIdx >= chapters.length) {
      setRun(false);
      setCurrentSteps([]);
      return;
    }
    const chapter = chapters[chapterIdx];
    if (location.pathname === chapter.path) {
      const t = setTimeout(() => {
        setCurrentSteps(chapter.steps);
        setRun(true);
      }, 700);
      return () => clearTimeout(t);
    } else {
      setRun(false);
      setCurrentSteps([]);
    }
  }, [chapterIdx, location.pathname, restartKey]);

  const goToNextChapter = () => {
    const next = chapterRef.current + 1;
    if (next < chapters.length) {
      setChapterIdx(next);
      chapterRef.current = next;
      navigate(chapters[next].path);
    } else {
      localStorage.setItem(TOUR_KEY, 'true');
      setChapterIdx(-1);
      chapterRef.current = -1;
    }
  };

  const handleCallback = (data) => {
    if (data.status === STATUS.FINISHED) {
      setRun(false);
      goToNextChapter();
    }
    if (data.action === ACTIONS.SKIP || data.action === ACTIONS.CLOSE) {
      setRun(false);
      localStorage.setItem(TOUR_KEY, 'true');
      setChapterIdx(-1);
      chapterRef.current = -1;
    }
  };

  const restartTour = () => {
    localStorage.removeItem(TOUR_KEY);
    chapterRef.current = 0;
    setChapterIdx(0);
    setRestartKey(k => k + 1);
    navigate(chapters[0].path);
  };

  window.__restartTour = restartTour;

  if (chapterIdx === -1 || !currentSteps.length) return null;

  return (
    <Joyride
      key={chapterIdx}
      steps={currentSteps}
      run={run}
      continuous
      showProgress
      showSkipButton
      disableScrolling
      hideCloseButton
      styles={{
        options: {
          primaryColor: '#e91e63',
          textColor: '#1a1a2e',
          backgroundColor: '#ffffff',
          arrowColor: '#ffffff',
          overlayColor: 'rgba(0, 0, 0, 0.5)',
        },
        tooltip: {
          borderRadius: 12,
          padding: '1.2rem',
          fontSize: '0.95rem',
        },
        tooltipTitle: { fontSize: '1.1rem', fontWeight: 700 },
        buttonNext: {
          backgroundColor: '#e91e63',
          borderRadius: 8,
          padding: '0.5rem 1.2rem',
          fontSize: '0.85rem',
        },
        buttonBack: { color: '#666', marginRight: 8 },
        buttonSkip: { color: '#999' },
      }}
      locale={{
        back: 'Atrás',
        close: 'Cerrar',
        last: 'Finalizar',
        next: 'Siguiente',
        skip: 'Saltar tour',
      }}
      callback={handleCallback}
    />
  );
}

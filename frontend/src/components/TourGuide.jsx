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
        content: 'Bienvenido al panel de control. Aquí ves un resumen rápido de todo tu negocio en tiempo real.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.metrics-grid',
        content: 'Tarjetas con indicadores clave: estado de WhatsApp, contactos activos, chats del día y ventas de hoy. Cada una te da una vista rápida del rendimiento.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card:first-child',
        content: 'Productos más vendidos del día. Muestra nombre, cantidad vendida e ingresos generados. Ideal para identificar tus artículos estrella.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card:nth-child(2)',
        content: 'Alertas de inventario: productos con stock bajo o agotado que requieren atención inmediata para evitar quedarte sin existencias.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card.full-width',
        content: 'Últimas transacciones del día: clientes que han comprado, montos, métodos de pago y horarios. Todo el movimiento reciente en un solo vistazo.',
        placement: 'top',
      },
      {
        target: '[data-tour="nav-dashboard"]',
        content: 'Usa el menú lateral para navegar entre secciones. Cada icono te lleva a una funcionalidad diferente del sistema.',
        placement: 'right',
      },
      {
        target: '[data-tour="whatsapp-status"]',
        content: 'Indicador de conexión de WhatsApp. Si está verde, el bot está activo y recibiendo mensajes. Rojo significa que hay que reconectar.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/products',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Catálogo de productos. Aquí administras todo tu inventario: precios, stock, imágenes y estados.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: 'Barra de herramientas: busca productos por nombre, filtra por categoría, importa desde Excel o crea un producto nuevo desde cero.',
        placement: 'bottom',
      },
      {
        target: '.products-grid',
        content: 'Cada tarjeta representa un producto con imagen, nombre, precio, stock disponible y acciones. Los productos con stock bajo se marcan en rojo automáticamente.',
        placement: 'top',
      },
      {
        target: '.prod-actions',
        content: 'Acciones por producto: editar datos, ajustar stock, activar/desactivar (mostrarlo u ocultarlo del catálogo) o eliminar definitivamente.',
        placement: 'left',
      },
      {
        target: '.search-input',
        content: 'Escribe aquí para filtrar productos al instante. Busca por nombre o código del producto.',
        placement: 'bottom',
      },
    ],
  },
  {
    path: '/contacts',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Tus contactos. Clientes que han escrito al negocio desde WhatsApp, organizados y clasificados.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: 'Busca contactos por nombre o teléfono, y filtra por tipo de cliente: todos, nuevos, recurrentes o VIP.',
        placement: 'bottom',
      },
      {
        target: '.data-table',
        content: 'Tabla completa con nombre, teléfono, tipo de cliente, nivel de confianza, etapa de compra, ciudad y última interacción. Toda la información de cada cliente en un vistazo.',
        placement: 'top',
      },
      {
        target: '.pagination',
        content: 'Navega entre páginas para explorar todos tus contactos. El sistema paginada automáticamente cuando hay muchos registros.',
        placement: 'top',
      },
      {
        target: 'th:nth-child(5)',
        content: 'La columna de confianza indica qué tan consolidado es el cliente basado en su historial de compras.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/conversations',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Conversaciones de WhatsApp. El corazón del sistema: aquí chateas directamente con tus clientes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.chat-list',
        content: 'Lista de conversaciones activas. Cada una muestra el nombre del cliente, el último mensaje, la hora y un contador de mensajes sin leer.',
        placement: 'right',
      },
      {
        target: '.chat-panel',
        content: 'Al seleccionar una conversación, ves el historial completo de mensajes. Los mensajes del cliente aparecen a la izquierda, los tuyos a la derecha.',
        placement: 'left',
      },
      {
        target: '.chat-input',
        content: 'Escribe tu respuesta aquí y presiona Enter o el botón Enviar. El mensaje llegará al cliente por WhatsApp al instante.',
        placement: 'top',
      },
      {
        target: '.chat-header',
        content: 'Cabecera de la conversación: nombre del cliente, su ciudad y su tipo. También puedes ver el detalle del contacto desde aquí.',
        placement: 'bottom',
      },
      {
        target: '.unread-badge',
        content: 'Los mensajes no leídos se marcan con un distintivo rojo. Así sabes qué conversaciones requieren atención prioritaria.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/orders',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Gestión de pedidos. Aquí ves y administras todas las órdenes recibidas desde WhatsApp.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.mini-metrics',
        content: 'Resumen rápido: pedidos pagados, total cobrado hoy, pedidos enviados y pendientes. Un vistazo al estado de tus ventas.',
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: 'Filtra pedidos por estado: Pendiente, Pagado, Enviado, Entregado o Cancelado. También puedes buscar por cliente o fecha.',
        placement: 'bottom',
      },
      {
        target: '.data-table',
        content: 'Tabla de pedidos con cliente, productos solicitados, ciudad, monto total, estado actual y fecha. Cada fila es una orden completa.',
        placement: 'top',
      },
      {
        target: 'select.status-select',
        content: 'Cambia el estado de cada pedido directamente desde aquí. Al actualizarlo, el sistema notifica al cliente por WhatsApp automáticamente.',
        placement: 'left',
      },
      {
        target: '.pagination',
        content: 'Navega entre páginas de pedidos. El historial completo siempre está disponible para consulta.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/employee-access',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Personal autorizado para usar el WhatsApp de la sede. Controla quién puede atender clientes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: 'Botón "Autorizar Nuevo" para agregar empleados que puedan atender WhatsApp desde el panel administrativo.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid',
        content: 'Cada tarjeta muestra un empleado autorizado: nombre, número de teléfono y fecha de autorización. Puedes revocar el acceso en cualquier momento.',
        placement: 'top',
      },
      {
        target: '.empty-state',
        content: 'Si no hay empleados autorizados, verás un mensaje indicando que aún no se ha agregado ninguno.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/campaigns',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Campañas de marketing automatizadas. Envía mensajes masivos a tus clientes por WhatsApp.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: 'Crea una nueva campaña: define el mensaje que quieres enviar y selecciona los destinatarios por tipo de cliente o por sede.',
        placement: 'bottom',
      },
      {
        target: '.campaigns-grid',
        content: 'Cada campaña muestra el mensaje, estado (activa/inactiva), estadísticas de envío y botón para ejecutarla. Las activas se disparan automáticamente según las condiciones.',
        placement: 'top',
      },
      {
        target: '.campaign-card .btn-execute',
        content: 'Ejecuta la campaña manualmente con este botón. El sistema enviará los mensajes a todos los destinatarios seleccionados.',
        placement: 'left',
      },
      {
        target: '.campaign-card .campaign-stats',
        content: 'Estadísticas de la campaña: cuántos mensajes se enviaron, cuántos se entregaron y cuántos clientes respondieron.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/settings',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Configuración general del sistema para tu sede.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.settings-grid .card:first-child',
        content: 'Conexión WhatsApp: aquí ves el código QR para conectar tu número, el estado actual de la conexión y el botón para desconectar si necesitas cambiar de número.',
        placement: 'bottom',
      },
      {
        target: '.qr-container',
        content: 'Escanea este código QR con tu WhatsApp para conectar el número al sistema. Una vez conectado, el bot empezará a recibir y responder mensajes automáticamente.',
        placement: 'bottom',
      },
      {
        target: '.settings-grid .card:nth-child(2)',
        content: 'Configuración de Wompi (pasarela de pagos): aquí ingresas tus credenciales para recibir pagos con Nequi, Daviplata y tarjetas de crédito/débito.',
        placement: 'bottom',
      },
      {
        target: '.settings-grid .card:last-child',
        content: 'Sincronización con Google Drive: agrega enlaces de Google Sheets para importar tu catálogo de productos desde Excel de forma automática.',
        placement: 'top',
      },
      {
        target: '.connection-status',
        content: 'Estado detallado de la conexión: si está "Conectado", el bot funciona correctamente. Si ves "Desconectado" o "Escaneo requerido", necesitas reconectar.',
        placement: 'right',
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
        content: 'Gestión de sedes. Administra todas las sucursales de tu negocio desde un solo lugar.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.table-wrap',
        content: 'Tabla de sedes con nombre, ciudad, estado (activo/inactivo), empleados asignados y acciones. Cada sede opera con su propio WhatsApp y configuración.',
        placement: 'top',
      },
      {
        target: 'a[href*="branches/settings"]',
        content: 'Botón "Configurar" en cada sede. Te lleva a la página de configuración detallada de esa sucursal: horarios, admins e información.',
        placement: 'left',
      },
      {
        target: '.status-badge',
        content: 'Indicador de estado de la sede. Verde si está activa, rojo si está desactivada. Puedes activar/desactivar sedes según necesites.',
        placement: 'right',
      },
      {
        target: '[data-tour="nav-branch-management"]',
        content: 'Desde el menú lateral puedes acceder a todas las secciones de infraestructura: sedes, mapa, empleados, stock global y horario.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/branches/settings/',
    matchFn: (path) => path.startsWith('/branches/settings/'),
    steps: [
      {
        target: 'h1.page-title',
        content: 'Configuración detallada de la sede. Aquí personalizas toda la información y funcionamiento de esta sucursal.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-tabs"]',
        content: 'Tres secciones: Información General (datos de la sede), Horario de Atención (cuándo abre/cierra) y Admins (quién recibe notificaciones internas).',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-save-info"]',
        content: 'Guarda los cambios de la información general: nombre, ciudad, dirección, teléfono, punto de referencia y notas.',
        placement: 'top',
      },
      {
        target: '[data-tour="branch-schedule-global"]',
        content: 'Activa o desactiva el horario global. Si está activo, la sede sigue el horario del sistema. Si lo desactivas, puedes definir un horario personalizado.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-admin-form"]',
        content: 'Agrega Admins para esta sede. Los admins reciben información y pueden hacer consultas internas al bot sin interferir con la atención al cliente.',
        placement: 'top',
      },
      {
        target: 'button',
        content: 'El botón de retroceso te devuelve a la gestión de sedes. Úsalo después de configurar la sucursal.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/branches/map',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Mapa de sedes. Visualiza todas tus sucursales en un mapa interactivo.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.leaflet-container',
        content: 'Cada marcador representa una sede física. Haz clic en cualquier marcador para ver información detallada de esa sucursal: dirección, teléfono y estado.',
        placement: 'top',
      },
      {
        target: '.leaflet-popup',
        content: 'Al hacer clic en un marcador, se abre un popup con el nombre de la sede, ciudad y enlace para ver más detalles.',
        placement: 'top',
      },
      {
        target: '[data-tour="nav-branch-map"]',
        content: 'Accede al mapa desde el menú lateral en la sección de infraestructura.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/employees',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Empleados del sistema. Gestiona quién tiene acceso al panel administrativo.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.table-wrap',
        content: 'Lista completa de empleados con nombre de usuario, nombre completo, sede asignada, rol y acciones disponibles.',
        placement: 'top',
      },
      {
        target: '.toolbar',
        content: 'Agrega nuevos empleados con el botón "Nuevo Empleado". Asígnale un usuario, contraseña, sede y rol (ADMIN o EMPLEADO).',
        placement: 'bottom',
      },
      {
        target: 'td .role-badge',
        content: 'Cada empleado tiene un rol: ADMIN (acceso total a todas las sedes y configuraciones) o EMPLEADO (acceso limitado a su sede asignada).',
        placement: 'right',
      },
      {
        target: '.btn-edit',
        content: 'Edita o elimina empleados desde aquí. Puedes cambiar su rol, sede o desactivar su acceso si ya no trabaja en el negocio.',
        placement: 'left',
      },
    ],
  },
  {
    path: '/inventory/global',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Stock global. Consulta el inventario de todas las sedes en un solo lugar.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.search-input',
        content: 'Busca productos por nombre en todas las sedes simultáneamente. Ideal para encontrar rápidamente un producto en cualquier sucursal.',
        placement: 'bottom',
      },
      {
        target: '.products-grid',
        content: 'Cada producto muestra el stock disponible por sede, permitiendo comparar inventarios. Así sabes dónde hay disponibilidad y dónde hace falta reponer.',
        placement: 'top',
      },
      {
        target: '.product-card .stock-badge',
        content: 'El stock se muestra separado por sede. Puedes ver cuántas unidades hay en cada sucursal y tomar decisiones de redistribución.',
        placement: 'right',
      },
      {
        target: '[data-tour="nav-global-inventory"]',
        content: 'Accede al stock global desde el menú lateral en infraestructura para monitorear todas tus sedes.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/system-settings',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Horario global del sistema. Configura el horario de atención para todas las sedes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.settings-grid',
        content: 'Define horarios de apertura, cierre y almuerzo que aplican a todas las sedes por defecto. Cada sede puede personalizar su propio horario si es necesario.',
        placement: 'top',
      },
      {
        target: 'select',
        content: 'Selecciona la hora de apertura y cierre global. El bot respeta estos horarios para responder automáticamente: solo atiende dentro del horario laboral.',
        placement: 'bottom',
      },
      {
        target: 'input[type="checkbox"]',
        content: 'Activa el cierre por almuerzo si el negocio pausa al mediodía. El bot no responderá durante ese período.',
        placement: 'right',
      },
      {
        target: '.save-btn',
        content: 'Guarda los cambios. El horario global se aplica a todas las sedes que tengan activada la opción "Usar Horario Global" en su configuración individual.',
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
    const matchFn = chapter.matchFn || ((p) => p === chapter.path);
    if (matchFn(location.pathname)) {
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

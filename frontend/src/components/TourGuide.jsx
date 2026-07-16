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
        content: 'Bienvenido al Panel de Control de Fantasías. Aquí ves un resumen completo de todo tu negocio en tiempo real: ventas, inventario, contactos y estado del bot.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'El nombre de tu sucursal aparece aquí. Si eres administrador global, puedes cambiar entre sedes usando el filtro que verás a la derecha.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-filter"]',
        content: 'Filtro de sedes (solo administradores). Selecciona "Vista Global" para ver datos de todas las sedes, o elige una sede específica para ver solo sus métricas. Los datos se actualizan automáticamente cada 30 segundos.',
        placement: 'bottom',
      },
      {
        target: '.metrics-grid',
        content: 'Cuatro indicadores clave: Estado de WhatsApp (conectado/desconectado), Contactos Activos en la base, Chats recibidos hoy y Ventas de hoy con monto total. Cada métrica se actualiza en tiempo real.',
        placement: 'bottom',
      },
      {
        target: '.metric-card.accent-purple',
        content: 'Estado de WhatsApp: muestra "Conectado" en verde si el bot está activo y recibiendo mensajes, o "Desconectado" en gris si hay que reconectar. Este es el indicador más importante del sistema.',
        placement: 'bottom',
      },
      {
        target: '.metric-card.accent-gold',
        content: 'Ventas de hoy: monto total recaudado y número de pedidos. Este número refleja todo lo que el bot ha vendido por WhatsApp hoy.',
        placement: 'bottom',
      },
      {
        target: '.dashboard-grid .card:first-child',
        content: 'Resumen de ventas del día: tabla con los productos más vendidos, cantidad de unidades y ingresos generados. Aquí identificas tus artículos estrella al instante.',
        placement: 'bottom',
      },
      {
        target: '.mini-table',
        content: 'Tabla de ventas: columna "Producto" con el nombre, "Cant." con las unidades vendidas y "Ingreso" con el dinero generado por cada producto.',
        placement: 'top',
      },
      {
        target: '.dashboard-grid .card:nth-child(2)',
        content: 'Alertas de inventario: lista de productos con stock bajo o agotado que necesitan reabastecimiento urgente. Cada alerta muestra el nivel (BAJO o AGOTADO) y la categoría del producto.',
        placement: 'bottom',
      },
      {
        target: '.stock-alert',
        content: 'Cada alerta muestra el nombre del producto, su categoría y el nivel de stock. Los marcados como "AGOTADO" en rojo significan que se quedaron sin existencias y no se pueden vender.',
        placement: 'right',
      },
      {
        target: '.dashboard-grid .card.full-width',
        content: 'Últimas transacciones del día: tabla con los 10 pedidos más recientes mostrando cliente, producto comprado, ciudad, monto y hace cuánto tiempo se realizó.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/products',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Catálogo de Productos. Aquí administras TODO tu inventario: crear, editar, ajustar stock, activar/desactivar y organizar productos por categoría. El bot usa esta información para vender por WhatsApp.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.metrics-grid',
        content: 'Resumen del inventario: Total de Productos registrados, Unidades Totales en stock, Valor Total del inventario en pesos y Productos con Stock Crítico (menos de 5 unidades) que necesitan atención.',
        placement: 'bottom',
      },
      {
        target: '.metric-card.accent-gold',
        content: 'Stock Crítico: muestra en rojo cuántos productos tienen 5 o menos unidades. Si este número es alto, necesitas reabastecer urgente.',
        placement: 'bottom',
      },
      {
        target: '.btn-secondary',
        content: 'Botón "Importar Excel": carga tu catálogo desde un archivo .xlsx, .xls o .csv. El sistema detecta automáticamente las columnas y crea los productos. También puedes arrastrar el archivo directamente.',
        placement: 'bottom',
      },
      {
        target: '.btn-primary',
        content: 'Botón "Nuevo Producto": abre el formulario para crear un producto manualmente con nombre, precio, categoría, stock, descripción e imagen.',
        placement: 'bottom',
      },
      {
        target: '.toolbar',
        content: 'Barra de herramientas: busca productos por nombre en tiempo real con el campo de búsqueda, y filtra por categoría usando el dropdown. El filtro se aplica instantáneamente.',
        placement: 'bottom',
      },
      {
        target: '.filter-select',
        content: 'Filtro de categorías: selecciona una categoría específica para ver solo esos productos. Las categorías incluyen todos los tipos de productos del catálogo.',
        placement: 'bottom',
      },
      {
        target: '.products-grid',
        content: 'Cuadrícula de productos: cada tarjeta muestra imagen, categoría, nombre, sede (si es multi-sucursal), descripción, precio, estado del stock y acciones disponibles.',
        placement: 'top',
      },
      {
        target: '.product-card .prod-category',
        content: 'Etiqueta de categoría: identifica el tipo de producto. Ayuda a organizar y filtrar el catálogo rápidamente.',
        placement: 'top',
      },
      {
        target: '.product-card .stock-indicator',
        content: 'Indicador de stock con semáforo: Verde (más de 5 unidades), Naranja (1-5 unidades = crítico), Rojo (0 unidades = agotado). Los productos en rojo no aparecen en el catálogo del bot.',
        placement: 'left',
      },
      {
        target: '.product-card .sold-count',
        content: 'Contador de vendidos: muestra cuántas unidades se han vendido de este producto. Útil para identificar los más populares.',
        placement: 'left',
      },
      {
        target: '.prod-actions',
        content: 'Acciones por producto: Botón de barras (ajustar stock), lápiz (editar datos), basura (desactivar del catálogo) o check verde (re-activar si estaba desactivado).',
        placement: 'left',
      },
      {
        target: '.modal-overlay',
        content: 'Modal de edición: formulario completo con 8 campos — Nombre, Precio, Categoría, Stock, Descripción, Descripción Emocional (la IA usa esto para vender mejor), Imagen (subir o URL) y Checkbox de Producto Estrella.',
        placement: 'top',
      },
      {
        target: '.form-grid .checkbox-wrap',
        content: 'Producto Estrella: marca este checkbox para que el bot destaque este producto en las conversaciones. Los productos estrella aparecen primero en las recomendaciones.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/contacts',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Contactos. Base de datos de todos los clientes que han escrito al negocio por WhatsApp. Cada contacto se clasifica automáticamente según su comportamiento de compra.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'El total de contactos registrados en tu base de datos. Este número crece automáticamente cuando nuevos clientes escriben al bot.',
        placement: 'bottom',
      },
      {
        target: '.toolbar .search-input',
        content: 'Búsqueda en tiempo real: escribe un nombre o número de teléfono para filtrar contactos al instante. No necesitas presionar enter.',
        placement: 'bottom',
      },
      {
        target: '.toolbar .filter-select',
        content: 'Filtro por tipo de cliente: NUEVO (primera interacción), TIMIDO (poca confianza), EXPLORADOR (pregunta mucho), DECIDIDO (listo para comprar) o RECURRENTE (compra frecuente).',
        placement: 'bottom',
      },
      {
        target: '.data-table thead',
        content: 'Columnas de la tabla: Nombre, Teléfono, Tipo (con badge de color), Nivel de Confianza, Etapa de Compra, Número de Compras, Ciudad y Última Interacción.',
        placement: 'bottom',
      },
      {
        target: '.badge',
        content: 'Badges de tipo de cliente: cada tipo tiene un color diferente — Azul (NUEVO), Púrpura (TIMIDO), Verde (EXPLORADOR), Dorado (DECIDIDO), Esmeralda (RECURRENTE). El bot adapta su tono según el tipo.',
        placement: 'right',
      },
      {
        target: 'th:nth-child(4)',
        content: 'Columna de Confianza: indica qué tan seguro se siente el cliente. Sube con cada compra y baja si no responde. El bot usa esto para decidir cuándo ofrecer productos.',
        placement: 'top',
      },
      {
        target: 'th:nth-child(5)',
        content: 'Etapa de Compra: muestra en qué punto del proceso de compra está el cliente — desde "Explorando" hasta "Listo para comprar". El bot guía al cliente según su etapa.',
        placement: 'top',
      },
      {
        target: '.pagination',
        content: 'Paginación: muestra 50 contactos por página. Usa los botones "Anterior" y "Siguiente" para navegar entre páginas.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/conversations',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Conversaciones de WhatsApp. El CORAZÓN del sistema. Aquí ves todas las conversaciones activas y puedes chatear directamente con tus clientes en tiempo real.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.chat-list',
        content: 'Panel izquierdo: lista de conversaciones activas. Cada una muestra el nombre del cliente, el último mensaje enviado, la hora y un icono de estado si está escalado o en modo manual.',
        placement: 'right',
      },
      {
        target: '.chat-item',
        content: 'Cada conversación muestra: nombre del cliente (o teléfono si no está registrado), preview del último mensaje (50 caracteres), hace cuánto se escribió y si tiene mensajes sin leer.',
        placement: 'right',
      },
      {
        target: '.chat-item-escalated',
        content: 'Icono de socorro (🆘): significa que la conversación fue escalada a un humano. El bot dejó de responder y un empleado debe tomar el control.',
        placement: 'right',
      },
      {
        target: '.chat-panel',
        content: 'Panel derecho: al seleccionar una conversación, ves el historial completo de mensajes. Los mensajes del cliente aparecen a la izquierda (gris), los del bot a la derecha (púrpura).',
        placement: 'left',
      },
      {
        target: '.chat-header',
        content: 'Cabecera: nombre del cliente, su ciudad y badge de estado. Aquí también está el botón para pausar/activar el bot en esta conversación específica.',
        placement: 'bottom',
      },
      {
        target: '.badge.badge-green',
        content: 'Badge de estado: AUTO (el bot responde automáticamente), MANUAL (un humano está respondiendo) o AYUDA (escalado, nadie está atendiendo).',
        placement: 'left',
      },
      {
        target: '.btn-sm',
        content: 'Botón de control: "Pausar Bot" pausa la IA para que un humano responda, "Activar Bot" reactiva las respuestas automáticas. El bot se pausa solo cuando envías un mensaje manual.',
        placement: 'left',
      },
      {
        target: '.chat-messages',
        content: 'Historial de mensajes: cada mensaje tiene contenido y hora. Los mensajes del cliente (USER) van a la izquierda, los del bot (ASSISTANT) a la derecha.',
        placement: 'top',
      },
      {
        target: '.chat-input',
        content: 'Campo de mensaje: escribe aquí para responder manualmente. Al enviar, el bot se pausa automáticamente en esta conversación. Presiona Enter o haz clic en "Enviar".',
        placement: 'top',
      },
    ],
  },
  {
    path: '/orders',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Gestión de Pedidos. Historial completo de todas las órdenes recibidas por WhatsApp. Aquí ves, filtras y administra el estado de cada pedido.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.mini-metrics',
        content: 'Resumen rápido: 4 tarjetas con Pagados ( cantidad), Total Cobrado (monto), Enviados y Pendientes. Ideal para ver el flujo del día de un vistazo.',
        placement: 'bottom',
      },
      {
        target: '.mini-metric.accent-green',
        content: 'Pedidos Pagados: cuántos pedidos ya tienen pago confirmado. Este número debería crecer durante el día.',
        placement: 'bottom',
      },
      {
        target: '.mini-metric.accent-gold',
        content: 'Total Cobrado: suma de todos los pedidos pagados hoy en pesos colombianos.',
        placement: 'bottom',
      },
      {
        target: '.toolbar .filter-select',
        content: 'Filtro por estado: PENDIENTE (esperando pago), PAGADO (confirmado, listo para enviar), ENVIADO (en camino), ENTREGADO (completado) o CANCELADO.',
        placement: 'bottom',
      },
      {
        target: '.data-table thead',
        content: 'Columnas: ID del pedido, Cliente (nombre y teléfono), Producto(s), Ciudad, Monto, Estado (con badge), Fecha y Acciones (cambio de estado inline).',
        placement: 'bottom',
      },
      {
        target: '.mini-select',
        content: 'Cambio de estado inline: selecciona un nuevo estado directamente en la fila. Al cambiarlo, el sistema notifica al cliente por WhatsApp automáticamente.',
        placement: 'left',
      },
      {
        target: '.badge.badge-orange',
        content: 'Badges de estado con colores: Naranja (Pendiente), Azul (Pago Enviado), Verde (Pagado), Púrpura (Enviado), Esmeralda (Entregado), Rojo (Cancelado/Reembolsado).',
        placement: 'right',
      },
    ],
  },
  {
    path: '/employee-access',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Personal Autorizado. Controla quién puede usar el WhatsApp del bot como personal interno. Estos empleados pueden hacer consultas de inventario sin ser clientes.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'Estos empleados NO son clientes — son tu propio personal. Pueden preguntar al bot por stock, precios y productos sin que el sistema los trate como ventas.',
        placement: 'bottom',
      },
      {
        target: '.btn-primary',
        content: 'Botón "Autorizar Nuevo": abre el formulario para agregar un empleado. Necesitas su nombre y número de WhatsApp con código de país (ej: 573001234567).',
        placement: 'bottom',
      },
      {
        target: '.toolbar .search-input',
        content: 'Búsqueda: filtra empleados por nombre o número de teléfono. Útil cuando tienes mucho personal autorizado.',
        placement: 'bottom',
      },
      {
        target: '.card-glass',
        content: 'Tarjeta de empleado: muestra avatar, nombre, teléfono y fecha de autorización. El bot reconoce automáticamente estos números cuando escriben.',
        placement: 'top',
      },
      {
        target: '.btn-icon-danger',
        content: 'Botón de eliminar: revoca el acceso del empleado. Ya no podrá hacer consultas al bot. Se muestra un diálogo de confirmación antes de eliminar.',
        placement: 'left',
      },
      {
        target: '.modal-overlay',
        content: 'Modal de autorización: ingresa el nombre del empleado y su número de WhatsApp completo (con código de país). El sistema valida que tenga al menos 10 dígitos.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/campaigns',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Campañas de Marketing. Envía mensajes masivos por WhatsApp a segmentos específicos de clientes. Reactiva clientes inactivos o promociona nuevos productos.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'Las campañas te permiten contactar múltiples clientes a la vez con mensajes personalizados usando el nombre y ciudad de cada uno.',
        placement: 'bottom',
      },
      {
        target: '.toolbar .btn-primary',
        content: 'Botón "Nueva Campaña": abre el formulario para crear una campaña. Define el nombre, el mensaje con variables, los destinatarios y cuándo enviarla.',
        placement: 'bottom',
      },
      {
        target: '.campaigns-grid',
        content: 'Cuadrícula de campañas: cada tarjeta muestra nombre, estado (badge), mensaje (preview de 100 caracteres), estadísticas de envío y botón para ejecutar.',
        placement: 'top',
      },
      {
        target: '.campaign-top .badge',
        content: 'Estados de campaña: BORRADOR (aún no configurada), PROGRAMADA (envío pendiente), EN EJECUCIÓN (enviando mensajes), COMPLETADA (todos los mensajes enviados), CANCELADA.',
        placement: 'right',
      },
      {
        target: '.campaign-stats',
        content: 'Estadísticas: Objetivo (cuántos contactos serán contactados), Enviados (mensajes entregados) y Respuestas (clientes que respondieron).',
        placement: 'top',
      },
      {
        target: '.campaign-msg',
        content: 'Preview del mensaje: los primeros 100 caracteres del mensaje que se enviará. Puedes usar {nombre} y {ciudad} para personalizar cada mensaje.',
        placement: 'top',
      },
      {
        target: '.modal-overlay .form-group',
        content: 'Formulario de campaña: Nombre de la campaña, Mensaje con variables {nombre} y {ciudad}, Filtro de Ciudad, Tipo de Cliente, Fecha/Hora de envío programado y Checkbox "Solo inactivos (+30 días)".',
        placement: 'top',
      },
      {
        target: '.campaigns-grid .btn-primary',
        content: 'Botón "Ejecutar": envía la campaña inmediatamente. Aparece un diálogo de confirmación que muestra cuántos contactos recibirán el mensaje antes de enviar.',
        placement: 'left',
      },
    ],
  },
  {
    path: '/settings',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Configuración de tu sucursal. Aquí conectas WhatsApp, configuras los pagos con Wompi, administras notificaciones y sincronizas tu inventario con Google Drive.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '[data-tour="whatsapp-card"]',
        content: 'Canal de Ventas WhatsApp: tarjeta principal que controla la conexión del bot. Muestra el estado actual y el código QR para conectar tu número de WhatsApp Business.',
        placement: 'bottom',
      },
      {
        target: '.badge-green',
        content: 'Badge de estado: "CONECTADO" en verde significa que el bot está activo y procesando mensajes. "Desconectado" significa que hay que reconectar escaneando el QR.',
        placement: 'right',
      },
      {
        target: '[data-tour="qr-container"]',
        content: 'Código QR: escanea este código con tu WhatsApp Business (Ajustes > Dispositivos vinculados > Vincular dispositivo). El QR se actualiza cada 20 segundos. Una vez conectado, el bot empieza a recibir mensajes.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="wompi-card"]',
        content: 'Pasarela Wompi: configura las credenciales para recibir pagos con Nequi, Daviplata y tarjetas de crédito/débito. Necesitas: Merchant ID, Public Key, Private Key e Integrity Secret.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="notification-phone"]',
        content: 'Teléfono de Notificación Principal: número con código de país (sin +) donde llegarán PRIMERO las alertas de venta. Ej: 573001234567. Es tu canal primario de notificaciones.',
        placement: 'top',
      },
      {
        target: '[data-tour="notification-group"]',
        content: 'Grupo de Notificación WhatsApp (Respaldo): nombre exacto de un grupo de WhatsApp donde también llegarán las alertas de venta. Sirve como respaldo si no puedes revisar el teléfono principal.',
        placement: 'top',
      },
      {
        target: '[data-tour="drive-sync"]',
        content: 'Sincronización Google Drive: conecta hojas de Excel desde Google Drive para actualizar tu inventario automáticamente. Agrega una fuente con nombre y URL, y sincroniza cuando necesites.',
        placement: 'top',
      },
      {
        target: '.sync-item',
        content: 'Cada fuente de Drive muestra: nombre, URL, estado de la última sincronización (EXITOSA/PENDIENTE), fecha de la última sincronización y botones para sincronizar ahora o eliminar.',
        placement: 'top',
      },
      {
        target: '[data-tour="audit-table"]',
        content: 'Tabla de Auditoría (solo admins): últimas 5 transacciones con ID, estado (LIQUIDADO = pagado) y monto. Útil para verificar pagos rápidamente.',
        placement: 'top',
      },
      {
        target: '[data-tour="save-config"]',
        content: 'Botón "Guardar Configuración General": GUARDA TODO — credenciales Wompi, teléfono de notificación y grupo de WhatsApp. Debes guardar ANTES de conectar WhatsApp.',
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
        content: 'Instalaciones SaaS: Gestión de Sedes. Administra TODAS las sucursales de tu negocio a nivel nacional. Cada sede opera con su propio WhatsApp y configuración independiente.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'Red nacional de sucursales y puntos de venta. Aquí creas, configuras, activas o desactivas cada sede del negocio.',
        placement: 'bottom',
      },
      {
        target: '.btn-primary',
        content: 'Botón "+ Nueva Sucursal": abre el formulario para crear una sede. Necesitas: nombre de fantasía, ciudad, dirección, teléfono y contraseña del manager.',
        placement: 'bottom',
      },
      {
        target: '.products-grid .product-card',
        content: 'Tarjeta de cada sede: nombre, ciudad, badge de estado (Activa/Inactiva), dirección, teléfono y mini métricas de hoy (ventas y pedidos).',
        placement: 'top',
      },
      {
        target: '.badge-green',
        content: 'Badge de estado: "Activa" en verde = la sede está operativa y el bot responde. "Inactiva" en gris = la sede está cerrada y el bot no procesa mensajes.',
        placement: 'right',
      },
      {
        target: '.product-card .btn-secondary',
        content: 'Botones de acción por sede: "Configurar" te lleva a la configuración detallada (horarios, admins, datos), "Auditoría" muestra el historial de ventas de esa sede.',
        placement: 'left',
      },
      {
        target: '.modal-overlay .form-group',
        content: 'Modal Nueva Sede: formulario con 5 campos — Nombre de Fantasía, Ciudad, Teléfono, Dirección Administrativa y Contraseña del Manager. Al crearla, se genera automáticamente un usuario manager.',
        placement: 'top',
      },
      {
        target: '.card .data-table',
        content: 'Modal Auditoría Detallada: tabla completa de ventas de una sede con Fecha/Hora exacta, Cliente/Canal, Desglose de Productos (cantidad x nombre x precio) y Valor Total.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/branches/settings/',
    matchFn: (path) => path.startsWith('/branches/settings/'),
    steps: [
      {
        target: 'h1.page-title',
        content: 'Configuración detallada de la sede. Aquí personalizas TODA la información y el funcionamiento de esta sucursal específica.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: 'button:first-of-type',
        content: 'Botón de retroceso: te devuelve a la gestión de sedes. Úsalo después de guardar los cambios de configuración.',
        placement: 'right',
      },
      {
        target: '[data-tour="branch-tabs"]',
        content: 'Tres pestañas: Información General (datos de la sede), Horario de Atención (cuándo abre/cierra) y Admins (quién recibe notificaciones internas).',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-tabs"] button:first-child',
        content: 'Pestaña Información General: formulario con Nombre, Ciudad, Dirección, Teléfono, Punto de Referencia, Descripción de Fachada y Notas Adicionales.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-save-info"]',
        content: 'Botón "Guardar Información": guarda todos los datos de la sede. El nombre aparece en el chat del bot y la dirección se usa para ubicación.',
        placement: 'top',
      },
      {
        target: '[data-tour="branch-tabs"] button:nth-child(2)',
        content: 'Pestaña Horario de Atención: configura si la sede sigue el horario global del sistema o tiene horario propio personalizado.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-schedule-global"]',
        content: 'Toggle Horario Global: cuando está activo (verde), la sede usa el horario del sistema. Cuando lo desactivas, puedes definir horas de apertura, cierre, días y almuerzo propios.',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-tabs"] button:nth-child(3)',
        content: 'Pestaña Admins: gestiona los LIDs de WhatsApp autorizados para recibir información interna de la sede (nunca reciben mensajes de ventas).',
        placement: 'bottom',
      },
      {
        target: '[data-tour="branch-admin-form"]',
        content: 'Agregar Admin: ingresa el LID de WhatsApp del admin (identificador numérico) y su nombre. Los admins pueden hacer consultas al bot sin interferir con la atención al cliente.',
        placement: 'top',
      },
    ],
  },
  {
    path: '/branches/map',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Mapa de Sedes. Visualización geográfica de TODAS tus sucursales en un mapa interactivo de Colombia. Ideal para ver la cobertura de tu red.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'Vista general de la red nacional de sucursales Fantasías. El mapa muestra automáticamente todas las sedes que tengan coordenadas geográficas registradas.',
        placement: 'bottom',
      },
      {
        target: '.leaflet-container',
        content: 'Mapa interactivo de Colombia (centrado en Bogotá, zoom 6). Cada marcador púrpura representa una sede física. Puedes hacer zoom, arrastrar y hacer clic en los marcadores.',
        placement: 'top',
      },
      {
        target: '.leaflet-popup',
        content: 'Popup del marcador: al hacer clic, ves el nombre de la sede, su ciudad, cantidad de productos en inventario y número de pedidos realizados.',
        placement: 'top',
      },
      {
        target: '.metric-card.accent-purple',
        content: 'Métrica "Sedes Activas": total de sucursales que aparecen en el mapa (solo las que tienen coordenadas geográficas configuradas).',
        placement: 'bottom',
      },
      {
        target: '.metric-card.accent-blue',
        content: 'Métrica "Stock en Red": suma de TODOS los productos de TODAS las sedes. Te da una vista del inventario total de la compañía.',
        placement: 'bottom',
      },
    ],
  },
  {
    path: '/employees',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Empleados. Gestión completa de TODO el personal del sistema. Aquí creas, editas y eliminas empleados, y asignas a qué sede pertenecen.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'Gestión de personal por sede. Cada empleado tiene un rol, funciones específicas y una sede asignada.',
        placement: 'bottom',
      },
      {
        target: '.btn-primary',
        content: 'Botón "Nuevo Empleado": abre el formulario para crear un empleado con nombre, teléfono, cargo, funciones y sede asignada.',
        placement: 'bottom',
      },
      {
        target: 'select',
        content: 'Filtro por sede: selecciona una sede específica para ver solo los empleados de esa sucursal, o "Todas las sedes" para ver todo el personal de la compañía.',
        placement: 'bottom',
      },
      {
        target: '.data-table thead',
        content: 'Columnas: Nombre, Teléfono, Cargo (con badge púrpura), Funciones (descripción), Sede asignada y Acciones (editar/eliminar).',
        placement: 'bottom',
      },
      {
        target: '.badge-purple',
        content: 'Badge de Cargo: muestra el rol del empleado (Encargada, Asesora, Directora, etc.). Este es un campo libre que tú defines.',
        placement: 'right',
      },
      {
        target: '.btn-icon',
        content: 'Acciones por empleado: botón de lápiz para editar (abre el mismo formulario con los datos precargados) y botón de basura para eliminar permanentemente.',
        placement: 'left',
      },
      {
        target: '.modal-overlay .form-group',
        content: 'Formulario de empleado: Nombre Completo, Teléfono, Cargo, Descripción de Funciones (qué hace en la empresa) y Sede (dropdown con todas las sedes).',
        placement: 'top',
      },
    ],
  },
  {
    path: '/inventory/global',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Inventario Global. Búsqueda de productos en TODAS las sedes de la compañía simultáneamente. Ideal para encontrar un producto específico o comparar stock entre sucursales.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '.page-subtitle',
        content: 'Localiza productos y stock en cualquier sucursal del país. La búsqueda recorre todas las bases de datos de sedes.',
        placement: 'bottom',
      },
      {
        target: 'form',
        content: 'Formulario de búsqueda: escribe el nombre del producto o una palabra clave y presiona "Buscar". El sistema busca en todas las sedes al mismo tiempo.',
        placement: 'bottom',
      },
      {
        target: '.btn-primary',
        content: 'Botón "Buscar": ejecuta la búsqueda. Mientras busca muestra "Buscando...". La búsqueda es en tiempo real contra todas las sedes.',
        placement: 'right',
      },
      {
        target: '.data-table thead',
        content: 'Resultados: tabla con Producto (nombre), Sucursal (en púrpura), Ciudad, Categoría (badge), Precio y Stock con indicador de nivel.',
        placement: 'top',
      },
      {
        target: '.badge-stock',
        content: 'Indicador de stock: "CRÍTICO" en rojo si tiene 5 o menos unidades, "OK" en verde si tiene más de 5. Útil para decidir transferencias entre sedes.',
        placement: 'right',
      },
    ],
  },
  {
    path: '/system-settings',
    steps: [
      {
        target: 'h1.page-title',
        content: 'Horario del Sistema. Configuración GLOBAL de atención que aplica a TODAS las sedes por defecto. El bot respeta estos horarios para responder automáticamente.',
        disableBeacon: true,
        placement: 'bottom',
      },
      {
        target: '[data-tour="schedule-preview"]',
        content: 'Tarjeta de preview: muestra el horario activo actualmente con los días, horas de apertura/cierre y si hay almuerzo. Actualiza en tiempo real al cambiar la configuración.',
        placement: 'bottom',
      },
      {
        target: 'select',
        content: 'Horas de apertura y cierre: selecciona la hora de inicio y fin del horario laboral. El bot NO responderá fuera de estas horas (envía un mensaje automático).',
        placement: 'bottom',
      },
      {
        target: '[data-tour="holidays-section"]',
        content: 'Gestión de Festivos: días en los que la tienda está cerrada. Puedes cargar el preset "Colombia 2026" con todos los festivos oficiales, o agregar fechas manualmente en formato MM-DD.',
        placement: 'top',
      },
      {
        target: '.card button',
        content: 'Botón "Colombia 2026": carga automáticamente los 18 festivos oficiales de Colombia. También puedes agregar festivos manualmente con el campo de texto y el botón "+ Agregar".',
        placement: 'right',
      },
      {
        target: 'span[style*="borderRadius: 8px"]',
        content: 'Chips de festivos: cada festivo aparece como una etiqueta con el nombre del día y un botón × para eliminarlo. Puedes personalizar la lista完全.',
        placement: 'top',
      },
      {
        target: '[data-tour="auto-reply-section"]',
        content: 'Mensaje Fuera de Horario: texto que el bot envía automáticamente cuando un cliente escribe fuera del horario laboral. Personalízalo con el mensaje que quieras.',
        placement: 'top',
      },
      {
        target: 'textarea',
        content: 'Área de texto para el mensaje automático: explica al cliente cuál es el horario de atención y que será atendido pronto. El bot lo envía solo cuando escribe fuera de horario.',
        placement: 'top',
      },
      {
        target: '[data-tour="save-settings"]',
        content: 'Botón "Guardar Configuración": guarda TODOS los cambios — horario, días, almuerzo, festivos y mensaje automático. El horario se aplica inmediatamente a todas las sedes.',
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
    } else if (data.action === ACTIONS.SKIP || data.action === ACTIONS.CLOSE) {
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
          maxWidth: '380px',
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

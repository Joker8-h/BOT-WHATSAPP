import { useState, useEffect } from 'react';
import { Joyride, ACTIONS, STATUS } from 'react-joyride';
import { useAuth } from '../context/AuthContext';

const TOUR_KEY = 'fantasias_tour_completed';

export default function TourGuide() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [run, setRun] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_KEY);
    if (!completed) {
      const timer = setTimeout(() => setRun(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const steps = [
    {
      target: 'body',
      placement: 'center',
      title: '🌟 Bienvenido a Fantasías',
      content: 'Este panel te permite administrar tu negocio: productos, pedidos, campañas y más. Te haremos un recorrido rápido por las secciones principales.',
      disableBeacon: true,
    },
    {
      target: '[data-tour="nav-dashboard"]',
      content: 'Aquí ves un resumen general del negocio: ventas del día, pedidos pendientes, productos bajos en stock y estado de WhatsApp.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-products"]',
      content: 'Gestiona tu catálogo de productos: precios, stock, imágenes y disponibilidad por sede.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-contacts"]',
      content: 'Consulta el historial de clientes que han escrito al WhatsApp.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-chats"]',
      content: 'Revisa las conversaciones activas con clientes desde WhatsApp.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-orders"]',
      content: 'Administra los pedidos recibidos: pendientes, pagados, despachados y entregados.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-employee-access"]',
      content: 'Controla qué empleados tienen acceso al WhatsApp de la sede.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-campaigns"]',
      content: 'Crea campañas de marketing automatizadas para tus clientes.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-settings"]',
      content: 'Configura tu perfil y preferencias personales.',
      placement: 'right',
    },
  ];

  const adminSteps = isAdmin ? [
    {
      target: isAdmin ? '[data-tour="nav-branch-management"]' : 'body',
      content: 'Administra las sedes: crea, edita o desactiva sucursales.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-branch-map"]',
      content: 'Visualiza todas las sedes en un mapa interactivo.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-employees"]',
      content: 'Gestiona los empleados del sistema y sus permisos.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-global-inventory"]',
      content: 'Consulta el stock global de todas las sedes en un solo lugar.',
      placement: 'right',
    },
    {
      target: '[data-tour="nav-system-settings"]',
      content: 'Configura el horario global del sistema para todas las sedes.',
      placement: 'right',
    },
  ] : [];

  const allSteps = [
    ...steps,
    ...adminSteps,
    {
      target: '[data-tour="whatsapp-status"]',
      content: 'Este indicador te muestra si el WhatsApp está conectado. Debe estar verde para recibir mensajes.',
      placement: 'right',
    },
    {
      target: '[data-tour="logout-btn"]',
      content: 'Aquí puedes cerrar sesión cuando termines.',
      placement: 'right',
    },
    {
      target: 'body',
      placement: 'center',
      title: '🎉 ¡Listo!',
      content: 'Ya conoces las secciones principales. Puedes reiniciar este tour cuando quieras desde el botón en la barra lateral. ¡A trabajar!',
    },
  ];

  const handleJoyrideCallback = (data) => {
    const { action, status, type } = data;
    if (action === ACTIONS.CLOSE || action === ACTIONS.SKIP) {
      localStorage.setItem(TOUR_KEY, 'true');
      setRun(false);
    }
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      localStorage.setItem(TOUR_KEY, 'true');
      setRun(false);
    }
  };

  const restartTour = () => {
    localStorage.removeItem(TOUR_KEY);
    setRun(true);
  };

  window.__restartTour = restartTour;

  return (
    <Joyride
      steps={allSteps}
      run={run}
      continuous
      showProgress
      showSkipButton
      disableScrolling
      scrollToFirstStep
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
        tooltipTitle: {
          fontSize: '1.1rem',
          fontWeight: 700,
        },
        buttonNext: {
          backgroundColor: '#e91e63',
          borderRadius: 8,
          padding: '0.5rem 1.2rem',
          fontSize: '0.85rem',
        },
        buttonBack: {
          color: '#666',
          marginRight: 8,
        },
        buttonSkip: {
          color: '#999',
        },
      }}
      locale={{
        back: 'Atrás',
        close: 'Cerrar',
        last: '¡Entendido!',
        next: 'Siguiente',
        skip: 'Saltar',
      }}
      callback={handleJoyrideCallback}
    />
  );
}

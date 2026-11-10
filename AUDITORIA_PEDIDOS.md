# Auditoría del flujo de pedidos

Fecha: 2026-11-10

Actualización: se autorizaron y ejecutaron pruebas conectadas. Ver `RESULTADOS_PRUEBAS.md` para resultados actuales, 15 pruebas locales y las limitaciones de MySQL intermitente y Wompi configurado en producción. El rechazo de permisos descrito abajo corresponde a la sesión anterior y fue resuelto con autorización explícita.

## Segunda revisión

- MySQL respondió a `SELECT 1` al comprobarlo fuera del sandbox. El fallo de conexión anterior no prueba una caída de producción.
- Corregido Wompi: los pagos con monto incorrecto o moneda distinta a COP quedan en revisión sin confirmación de compra, métricas ni instrucción de despacho. Se aplica también al flujo de pedidos antiguos.
- La reserva de todos los productos de un pago Wompi ahora se ejecuta en una transacción; si falla, se marca revisión y se avisa al propietario antes de confirmar despacho.
- Los cierres exigen nombre y teléfono además de dirección y ciudad. Los carritos con productos sin identificar o agotados se detienen para revisión.
- La comparación de links repetidos usa el total con envío, ciudad y número de productos; se guarda la ciudad del link emitido.
- Los seguimientos usan la misma configuración de ciudades contraentrega que el cierre.
- Se invalida la caché del catálogo después de reservar stock.
- Verificación local actual: 8 pruebas pasan; sintaxis de los módulos modificados y build frontend correctos.
- Auditoría npm de dependencias de producción: backend 33 alertas (1 crítica, 23 altas, 9 moderadas); frontend 3 moderadas. Son avisos sobre paquetes, no una prueba de explotación. Queda pendiente evaluar y migrar las versiones afectadas.
- La revisión automática rechazó el simulador con catálogo real por exportación al proveedor IA externo. Esa prueba requiere aprobación explícita del usuario. No se enviaron mensajes a clientes ni se desplegaron estos cambios.

El sistema completo todavía no está certificado: falta la validación integrada de WhatsApp/Wompi y la resolución de dependencias, entrega/reintento de avisos y estados operativos.

## Resultado ejecutivo

El código compilaba, pero el flujo crítico no tenía pruebas automatizadas y tenía dos fallos de integridad que podían explicar pedidos perdidos o inconsistentes:

1. Las conversaciones `ESCALATED` no se recuperaban desde el CRM. El controlador tenía lógica para reactivarlas, pero nunca recibía esas conversaciones porque la consulta solo buscaba `ACTIVE` y `PAUSED`.
2. Contraentrega creaba el pedido y luego descontaba stock con lecturas/escrituras separadas. Dos cierres simultáneos podían vender la misma unidad o dejar un pedido asociado a un inventario incorrecto.

## Cambios aplicados

- `crmService.getActiveConversation` ahora conserva también `ESCALATED`.
- Se añadió `createOrderAndReserveStock`, que reserva inventario con una actualización condicional dentro de una transacción Prisma y crea el pedido en la misma transacción.
- Si un producto está agotado o el stock cambia durante el cierre, no se crea el pedido; el cliente recibe una explicación y el dueño recibe una alerta.
- Se añadió la suite `backend/test/orders-flow.test.js` y el comando `npm test`.

## Verificación realizada

- Backend: 5/5 pruebas pasan con `npm test`.
- Backend: todos los archivos JavaScript pasan `node --check`.
- Frontend: `npm run build` termina correctamente.
- `git diff --check` no reporta errores.

## Limitaciones pendientes

- El simulador completo no pudo ejecutar escenarios contra el catálogo real porque el MySQL configurado no respondió: `hayabusa.proxy.rlwy.net:38478`.
- Todavía falta una prueba end-to-end con WhatsApp Web y Wompi real/sandbox.
- El sistema depende de proveedores IA externos y el estado del proyecto indica problemas de cuota OpenAI; eso puede producir respuestas de fallback, pero no debe crear pedidos por sí solo.
- Las credenciales expuestas o valores por defecto mencionados en `ESTADO_PROYECTO.md` deben rotarse fuera del código antes de producción.

## Siguiente orden recomendado

1. Levantar un MySQL local o restaurar acceso al remoto y ejecutar `npm run simulate -- cierre-cod` y `npm run simulate -- nequi-cod`.
2. Probar en sandbox Wompi el webhook y confirmar transición `PAYMENT_SENT → PAID`.
3. Escanear QR de WhatsApp y validar un cierre completo con datos reales de prueba.
4. Cancelar los pedidos de prueba y revisar que el stock quede restaurado/consistente según la política operativa.

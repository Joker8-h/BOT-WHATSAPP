# Pruebas ejecutadas — 2026-11-10

## Ampliación de estabilización

- Se bloquea la generación de links cuando no se pudo persistir el carrito o su asociación al link.
- Un envío fallido de WhatsApp no se registra como link entregado.
- Se solicita confirmación cuando el producto aparece por primera vez durante el cierre.
- Se conservan identificadores LID en confirmaciones de pago; celulares locales se normalizan con prefijo 57.
- Contraentrega después de pago rechazado se ofrece solo en ciudades locales.
- Colas de mensajes separadas por sede y cliente.
- Falta de créditos OpenAI salta al siguiente proveedor; clasificación recuerda la indisponibilidad durante cinco minutos.
- Duplicados contraentrega comparan productos y cantidades completas.
- Cancelación previa al despacho devuelve stock una sola vez y detiene postventa. No se ejecutan reembolsos monetarios automáticos.
- `node scripts/verifyOrderTransaction.js` contra MySQL real: pedido creado, reserva correcta, cancelación repetida sin duplicar stock, rechazo de stock insuficiente y rollback total verificados. Confirmado que no quedan productos, contactos ni pedidos sintéticos persistidos.
- Se actualizaron Axios, Express y proxy-addr dentro de sus rangos existentes: auditoría de backend pasó de 33 a 28 alertas y eliminó la crítica. Persisten 19 altas y 9 moderadas; frontend conserva las alertas previamente registradas. No se declara el sistema libre de vulnerabilidades.

## Despliegue autorizado completado

- Versión activa: `d0e279c1-0cfc-48e1-93d1-4a36e896f410`, Railway `SUCCESS`.
- Verificación posterior, 2026-11-10 17:58 Colombia: `/health` `ok`, uptime 64 segundos, WhatsApp sede 1 `READY`.
- Panel web: HTTP 200, contenido HTML.
- Arranque: MySQL conectado; 7 migraciones conocidas y ninguna pendiente de aplicar.
- Primer intento `4f44487d-f46d-49f8-b382-1f06fa776cfd` falló al ejecutar el script con CRLF de Windows. Se corrigió Docker para normalizarlo a LF y se añadió `.gitattributes` para scripts shell. El primer intento quedó `REMOVED`.
- No se realizaron cobros ni pedidos de prueba persistidos durante el despliegue. Continúan pendientes las verificaciones funcionales completas y dependencias señaladas abajo.
- Publicado mediante carga local `railway up`. Los cambios locales no están confirmados ni enviados al repositorio Git: un futuro despliegue automático del repositorio podría reemplazar estas correcciones si no se integran allí.

Las secciones anteriores al despliegue se conservan como historial del diagnóstico; la versión activa y las comprobaciones de este apartado son el estado más reciente.

## Revisión directa de Railway

- Acceso confirmado al proyecto `Bot Fantasias`, entorno `production`, servicio `BOT-WHATSAPP`.
- Despliegue actual: `4e8c0129-333b-45b2-acd2-4d968c85a00c`, commit `751f0571c34a42f2c7bcfd8df5fd9077267878f0`.
- `/health` respondió `ok`; sesión WhatsApp sede 1 `READY`.
- Logs del 10 de noviembre: OpenAI sin créditos, seguido de `model_not_found`/404 en `gpt-4-turbo`. El controlador de fallback abortaba la cadena antes de llegar a Gemini.
- Reproducido con prueba sintética fallida; corregido para continuar ante modelo 404/no disponible. La prueba ahora pasa.
- Se limpian temporizadores de timeout al terminar cada llamada IA.
- Suite actual: 16/16 pruebas pasan; sintaxis IA y `git diff --check` correctos.
- Logs también muestran sincronización de catálogo fallida con 429 de la tienda. No se verificó que ese límite esté resuelto.
- Últimos 60 logs de MySQL no mostraron coincidencias del filtro de errores/reinicio; eso no descarta problemas intermitentes del proxy externo.

### Despliegue propuesto y reversión

Los cambios están locales, todavía sin publicar. Incluyen correcciones de pedidos, inventario, validación de pagos y fallback IA descritas en este informe y la auditoría. No se añadieron migraciones de esquema.

El despliegue reinicia el proceso y ejecuta el arranque existente, que contiene `migrate deploy`, limpieza de transacciones duplicadas y semillas. Conservar el volumen de WhatsApp. Verificar build, `/health`, logs y estado READY después del despliegue. Si falla la nueva versión, volver al despliegue anterior indicado arriba desde Railway; esa reversión de código no deshace cambios de datos producidos por el arranque ni por pedidos reales.

## Verificaciones locales

- `cd backend; npm test`: 15 pruebas, 15 pasan, sin omitidas.
- Firma Wompi correcta, rechazo de monto alterado y firma inválida.
- Webhook duplicado no vuelve a procesar la venta.
- Pagos con monto incorrecto o reserva fallida no confirman despacho.
- Bloqueo del cierre por nombre, teléfono, dirección o ciudad faltantes.
- Descarte de barrios capturados sin respaldo en mensajes del cliente.
- Extracción de datos, cantidades, conservación de conversación escalada y validación del evaluador.
- Build del frontend correcto; advertencia de bundle de 673 KB.
- `git diff --check`: sin errores.

## Escenarios con MySQL y Gemini reales

Se ejecutaron dos rondas de cinco escenarios, con contactos sintéticos en memoria, catálogo real y sin crear pedidos ni enviar WhatsApp.

| Escenario | Evidencia de la segunda ronda |
|---|---|
| Contraentrega Popayán | 9/9; captura datos y etiqueta contraentrega |
| Nequi Bogotá | 9/9; etiqueta Wompi; barrio inventado descartado |
| Corrección Bogotá → Popayán | Capturó Popayán y dirección sin etiqueta de cierre; evaluación impresa 5/6 exigía producto indebidamente |
| Dos unidades | Emitió dos productos de una unidad, total 114.400 con envío; evaluación impresa 8/9 esperaba erróneamente un producto x2 |
| Nequi Popayán | 9/9; etiqueta Wompi, barrio inventado descartado |

El evaluador ya corrige ambos errores de puntuación, con pruebas locales que cubren estos casos. La repetición conectada de esos dos escenarios no pudo arrancar por MySQL inaccesible. No se declara 5/5 con el evaluador final.

## Fallos operativos observados

- MySQL alternó conexiones correctas con errores de conexión al proxy remoto. Una consulta correcta contó 4 sedes y 183 productos.
- Clasificación OpenAI devolvió límites de uso en tres modelos repetidamente.
- Gemini devolvió varios 503; la cadena de respaldo respondió, pero algunos turnos demoraron aproximadamente 19–30 segundos.
- En todas las sedes, Wompi está configurado en producción. No se efectuaron cobros; la prueba completa con pasarela requiere credenciales sandbox.
- Se observaron selecciones de producto en cierres sin que el turno anterior hubiese recomendado un modelo concreto. Las etiquetas de cierre correctas por sí solas no garantizan que el cliente haya elegido ese producto; queda pendiente endurecer y verificar esa confirmación.

## Cambios derivados de las pruebas

- `aiService.validateCapturedData` descarta barrios ausentes de mensajes del cliente y de su ficha previa.
- El simulador comprueba datos inventados y cantidad total; la corrección de ciudad se evalúa sin exigir cierre.
- El simulador devuelve código de error si fallan comprobaciones.

## Alcance pendiente

No se ha validado creación persistida de pedidos, rollback/concurrencia contra MySQL real, entrega real de WhatsApp, checkout sandbox ni despliegue de estos cambios. Las 15 pruebas locales usan sustitutos en los límites externos. Continúan pendientes las vulnerabilidades de dependencias registradas en AUDITORIA_PEDIDOS.md.

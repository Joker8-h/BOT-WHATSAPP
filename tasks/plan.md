# Plan de estabilización del flujo de pedidos

## Objetivo

Hacer que el bot procese pedidos de WhatsApp de forma determinista: conservar la conversación correcta, capturar datos sin perderlos, validar productos y stock, crear el pedido o link una sola vez y dejar evidencia clara cuando una dependencia externa falle.

## Diagnóstico inicial basado en evidencia

- El frontend compila (`npm run build`).
- Todos los archivos JavaScript del backend pasan `node --check`.
- No existe una suite automatizada en `backend/package.json` ni `frontend/package.json`.
- El simulador no puede conectarse al MySQL configurado en `hayabusa.proxy.rlwy.net:38478`, por lo que los escenarios de IA no se pueden considerar verificados en este entorno.
- `crmService.getActiveConversation` excluye conversaciones `ESCALATED`, aunque `messageController` contiene lógica para reactivarlas; eso puede crear una conversación nueva y saltarse la pausa humana.
- La creación contraentrega descuenta stock con lectura + escritura separadas y sin transacción/condición, por lo que dos pedidos concurrentes pueden vender el mismo inventario.
- El cierre solo bloquea por ciudad/dirección, pero permite registrar con nombre o teléfono de entrega ausentes, aunque el prompt declara esos datos obligatorios.

## Tareas

### Fase 1: Pruebas de regresión del flujo de pedidos

- [x] Añadir pruebas Node nativas para conservación de conversaciones escaladas, extracción de datos y cantidades.
- [x] Añadir pruebas de coherencia del método de pago, revisión por monto incorrecto y reserva fallida.
- [ ] Ampliar pruebas de resolución de productos, datos mínimos y ciudades permitidas con el controlador completo.

### Punto de control 1

- [x] Las pruebas reprodujeron el fallo de conversaciones escaladas antes de modificar el código.
- [x] El resultado distingue fallos de lógica de fallos de infraestructura externa.

### Fase 2: Correcciones de integridad

- [x] Corregir la selección de conversación para que el estado `ESCALATED` no se pierda.
- [x] Hacer atómico el descuento de stock y evitar crear pedidos con productos agotados.
- [x] Aplicar validación de nombre, teléfono, dirección y ciudad antes de cualquier cierre.

### Punto de control 2

- [x] Pruebas de regresión pasan.
- [x] Sintaxis backend y build frontend pasan.

### Fase 3: Operación y diagnóstico

- [ ] Mejorar scripts de simulación para fallar de forma explícita cuando MySQL no está disponible.
- [x] Documentar comandos de prueba local y limitaciones de verificación con WhatsApp/Wompi.

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---:|---|
| MySQL remoto inaccesible | Alto | Tests unitarios con fakes y ejecutar integración cuando la DB esté disponible |
| Modelos IA externos variables | Alto | No depender de texto libre para validar reglas críticas |
| Pedidos concurrentes | Alto | Actualizaciones condicionales/transaccionales de stock |
| Conversación pausada por humano | Medio | Preservar `ESCALATED` y probar reactivación explícita |

## Fuera de alcance en esta iteración

- Rotación de credenciales, recarga de OpenAI, escaneo QR y pruebas en WhatsApp real; requieren acceso/decisión operativa del propietario.

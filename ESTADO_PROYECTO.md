# BOT-FANTASIAS — Estado del proyecto

> Generado: 2026-10-14. Deploy activo `6a7789de` SUCCESS. Rama `main` limpia.
> Panel: `https://bot-whatsapp-production-7094.up.railway.app` · Servicio Railway `BOT-WHATSAPP` (proyecto `Bot Fantasias`, env `production`) + MySQL.

## 1. Qué es y cómo corre

- Bot de WhatsApp (whatsapp-web.js + Chromium) con IA vendedora “Sofía”, CRM propio (MySQL + Prisma), pagos Wompi (link + webhook), contraentrega, catálogo desde tienda web + Excel/Drive, panel admin React servido por el mismo backend.
- Cadena IA: `OpenAI (gpt-4o + fallbacks) → Gemini (3.5-flash-lite + fallbacks) → Groq (gpt-oss-120b → 20b → qwen3.8-27b) → plantilla de respaldo`. Solo texto en secundarios; voz/visión/TTS en OpenAI (voz con fallback Groq Whisper).
- Conversación excelente = 7 datos: producto+cantidad, nombre, ciudad, dirección, barrio, teléfono 10d, método de pago.

## 2. Hecho y verificado ✅

### Estabilidad / config
- Puertos unificados (`5000`, respeta `$PORT`), `vite proxy 5000`, `railway.toml` con `healthcheck /health`.
- `backend/.env.example` completo (PORT, NODE_ENV, CORS_ORIGIN, FRONTEND_URL, ADMIN_PHONE, IA, Wompi, Cloudinary, EMAIL_*); `frontend/.env.example` con `VITE_API_BASE_URL`.
- `encryption.js` deriva clave 32B (SHA256) — ya no rompe con `Invalid key length`.
- `cloudinary.js` hereda `CLOUDINARY_URL`; `Dockerfile TZ=America/Bogota`; `docker-start.sh` con `migrate deploy` fail-fast (sin `db push`).
- Respuestas humanas 1.5–4s (antes 8–11s), ráfaga 6s, login limitado 15/15min, token JWT 1h.
- Migraciones con baseline resuelto (`P3005` superado el 2026-10-13); `20261014000000_contact_phone_per_branch` aplicada en prod.

### Cierre de ventas (probado en vivo con `scripts/simulateSale.js`)
- `cierre-cod` **9/9**: etiquetas + CONTRAENTREGA + Popayán (probado en Groq y en Gemini).
- `nequi-cod` alineado a Wompi (fix método↔cierre verificado por unit test).
- `correccion-ciudad`: last-wins OK (Bogotá→Popayán).
- `cantidad-prosa`: `_parseQuantity` entiende dos/par/docena (`XHH-190854` intacto, qty 1).
- `cierre-wompi`: datos 6/6; el cierre lo rescata el SAFETY-NET-CLOSE en prod.
- `SAFETY-NET-CONTRA/WOMPI/CLOSE`, `ORDER-GATE` (bloquea sin dirección/ciudad), `COD-GUARD` (convierte contra→Wompi fuera de COD), `samePending` (monto+ciudad), protocolo CLOSING obligatorio con ejemplo, prohibido “pedido queda registrado”.
- Prompt adelgazado (índice 60, 6 productos, sin URLs en complementos) para no chocar con topes Groq; reintento slim ante 413; `retry-after` topado a 10s.
- Placeholder `PENDIENTE POR CAPTURAR` ignorado; splits robustos `/[,\s]+/`.

### Pagos / pedidos
- Wompi: merge ENV+BD campo por campo, sync solo sede 1, `redirect_url` con `FRONTEND_URL`, `payment_links` con Bearer prod/sandbox, stock atómico `decrement`, subpago → revisión sin mover stock, `DECLINED→CANCELLED`, idempotencia `P2002` + `_inFlight`, alertas huérfana/mismatch.
- Ticket con subtotal+envío+total, aviso al dueño completo, `recordPurchase`, postventa programada.

### Multi-sede / seguridad
- `JWT_SECRET` fail-fast 32B + **rotado** en Railway (re-login requerido una vez).
- `requireRole` + `checkBranchAccess` deny-by-default global; ownership en conversaciones/campañas/envío-manual/empleados; campañas y filtros acotados por sede; cron campañas `America/Bogota`.
- `Contact @@unique([phone,branchId])` + `findOrCreateContact` P2002-safe.
- Seeds que solo rellenan vacíos (no pisan teléfono/password/Wompi del panel).
- Avisos al dueño al `573166575904` en las 4 sedes; `normalizeCoPhone` (10d→`57...`) en notify/masivos/follow-up/postventa/empleados/panel.

### Panel admin
- Base API única, 401+403 con un solo redirect, `AuthContext` no desloguea ante 500/red.
- Productos/pedidos paginados, debounce búsqueda, validaciones precio/stock/archivos.
- QR **local** (`qrcode.react`) por sucursal + expiración 60s + aviso de no compartir (ya no va a `qrserver.com`).
- Mapa sin mutación global + empty-state + lista sin coordenadas; backend valida y guarda lat/lng.
- `vite build` OK (`✓ built in ~2.3s`).

### Voz e higiene
- Transcripción OpenAI Whisper → fallback Groq `whisper-large-v3-turbo`.
- Logger solo-consola en prod, store URL firmada preservada, `invalidateCache` acepta `"1"/1`, sync Drive con retry/timeout, `importExcel` con `await` real + estrella por sede, uploads con `fileFilter`.

## 3. Funciona hoy (verificado en prod/logs) ✅
- Boot limpio, catálogo 176 productos sincronizados, seeds sin pisar, healthcheck OK.
- Turnos reales por Groq y Gemini con etiquetas correctas; `classifyClient` con fallback.
- Jugada completa contraentrega y link Wompi implementadas extremo a extremo (pendiente prueba B1 en WhatsApp real).

## 4. Falta / pendiente ⚠️

1. **Recargar OpenAI** (`platform.openai.com → Billing`): sin créditos, todo corre por secundarios (15–30s/turno, con 429/503 en picos). Con saldo, voz/visión/TTS vuelven al 100%. **No lo puedo hacer yo.**
2. **Rotar keys expuestas** en chat: `GROQ_API_KEY` (`gsk_…vfG`) y `GEMINI_API_KEY` (`AQ.A…yGqQ`) → crear nuevas y pedirme que las ponga por `--stdin`. Igual `ADMIN_PASSWORD=Fantasias2024!` y `MYSQL_PASSWORD` siguen default (rotar en ventana acordada).
3. **Escanear QR** tras cada redeploy (panel → Configuración → Generar QR, 60s por QR).
4. **Pruebas WhatsApp vivo A2/A3/B1** (guía en el informe del 2026-10-13): cierre total 7/7, goteo <6s, link sandbox→`PAID`; luego cancelar pedidos de prueba y revisar stock.
5. **Re-correr `cantidad-prosa` y `cierre-wompi`** con cuota fría (quedaron inconcluyentes por 429/413 del propio testeo).
6. Opcional: visión en Gemini Flash, bloat del system prompt, `dedupe` API-vs-Excel por nombre normalizado, tabla `WebhookEvent` + reenvío de avisos `PAID` no notificados, cookie httpOnly para el token, code-splitting del bundle (673KB).

## 5. Operación rápida

```bash
# Estado y logs
railway status
railway deployment list --service BOT-WHATSAPP
railway logs --service BOT-WHATSAPP --lines 60        # runtime
railway logs --service BOT-WHATSAPP --build --lines 40 # build
railway logs <DEPLOY_ID> --service BOT-WHATSAPP        # deploy puntual (migrate)

# Vars (nunca en git; keys por --stdin)
railway variable list --service BOT-WHATSAPP --kv
echo "nueva" | railway variable set NOMBRE --stdin --service BOT-WHATSAPP
railway deployment redeploy --yes --service BOT-WHATSAPP

# Simulador IA (requiere backend/.env local, no commitear)
cd backend
SIM_BRANCH_ID=1 node scripts/simulateSale.js cierre-cod
AI_PROVIDER_ORDER=gemini,groq SIM_BRANCH_ID=1 node scripts/simulateSale.js cierre

# Chequeos
node --check src/services/aiService.js  # + openai.js, decisionEngine.js, messageController.js, etc.
cd ../frontend && npm run build
```

- Proveedores: `AI_PROVIDER_ORDER=openai,gemini,groq` (solo texto en secundarios; visión salta secundarios).
- Modelos vigentes: Gemini `gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-flash-lite-latest → gemini-3.5-flash → gemini-3.8-flash` (`2.5-flash` retirado para cuentas nuevas; flash completos se saturan 503). Groq `openai/gpt-oss-120b → openai/gpt-oss-20b → qwen/qwen3.8-27b` (Llama retirados).
- Privacidad: el tier gratis de Gemini entrena con los prompts; datos de pago nunca van a la IA.
- No tocar sin avisar: `ENCRYPTION_KEY` (rompe Wompi cifrado), `Contact` unique, seeds en cada boot, volumen `/app/.wwebjs_auth` (borrarlo = QR nuevo).

# Slack Bot ↔ Antigravity Agent (Vercel Free Tier)

Bot de Slack que usa el gateway de **Google Antigravity Cloud Code** como cerebro backend. Cada mensaje que recibe el bot se envía al agente de Antigravity (Gemini, Claude, etc.) y la respuesta se postea de vuelta en Slack.

## Arquitectura

```
Usuario Slack
    │
    ▼
Bot de Slack (Events API)
    │
    ▼
Vercel Serverless Function ──── /api/slack/events
    │
    ▼
Google Antigravity Cloud Code
(cloudcode-pa.googleapis.com)
    │  ← OAuth2 Bearer Token
    ▼
Modelo IA (gemini-3-pro, claude-sonnet-4-6, etc.)
    │
    ▼
Respuesta → Slack Web API → Canal/DM del usuario
```

## Requisitos previos

- Cuenta de Google con acceso a **Antigravity** (la misma con la que usás el IDE)
- Cuenta de **Vercel** (plan gratuito funciona)
- Un **Slack Workspace** donde puedas crear apps

---

## Paso 1: Crear la Slack App

1. Andá a [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Ponele un nombre (ej: "Antigravity Bot") y seleccioná tu workspace
3. En **OAuth & Permissions**, agregá estos **Bot Token Scopes**:
   - `app_mentions:read` – leer cuando mencionan al bot
   - `chat:write` – enviar mensajes
   - `im:history` – leer mensajes directos
   - `im:read` – acceso a DMs
   - `reactions:read` – leer reacciones
   - `reactions:write` – agregar reacciones (indicador de "procesando")
4. Hacé click en **Install to Workspace** y autorizá
5. Copiá el **Bot User OAuth Token** (`xoxb-...`)
6. En **Basic Information**, copiá el **Signing Secret**

## Paso 2: Crear credenciales OAuth de Google

1. Andá a [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Creá o seleccioná un proyecto
3. **Create Credentials** → **OAuth Client ID**
4. Application type: **Web application**
5. Authorized redirect URIs: `https://tu-app.vercel.app/api/auth/callback`
   (reemplazá `tu-app` con el nombre real de tu deploy en Vercel)
6. Copiá el **Client ID** y el **Client Secret**

## Paso 3: Deploy en Vercel

### Opción A: Desde GitHub
```bash
# Cloná/subí el código a un repo de GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/tu-user/slack-antigravity-bot.git
git push -u origin main
```
Luego importá el repo en [vercel.com/new](https://vercel.com/new).

### Opción B: Desde CLI
```bash
npm i -g vercel
vercel login
vercel
```

### Configurar variables de entorno en Vercel:

En **Settings → Environment Variables**, agregá:

| Variable | Valor |
|----------|-------|
| `SLACK_BOT_TOKEN` | `xoxb-...` (del paso 1) |
| `SLACK_SIGNING_SECRET` | Signing secret (del paso 1) |
| `GOOGLE_CLIENT_ID` | Client ID de Google (del paso 2) |
| `GOOGLE_CLIENT_SECRET` | Client Secret de Google (del paso 2) |
| `GOOGLE_REDIRECT_URI` | `https://tu-app.vercel.app/api/auth/callback` |
| `ANTIGRAVITY_MODEL` | `gemini-3-pro` (o `claude-sonnet-4-6`, etc.) |
| `AGENT_SYSTEM_PROMPT` | Tu system prompt personalizado (opcional) |

## Paso 4: Obtener tokens de Google (OAuth)

1. Visitá `https://tu-app.vercel.app/api/auth/callback` en tu browser
2. Hacé click en **"Iniciar sesión con Google"**
3. Autenticá con **la misma cuenta de Google que usás en Antigravity**
4. Copiá los tokens que aparecen
5. Agregá en Vercel env vars:
   - `GOOGLE_ACCESS_TOKEN` → el access token
   - `GOOGLE_REFRESH_TOKEN` → el refresh token
6. Redeployá: `vercel --prod` o desde el dashboard

## Paso 5: Conectar Slack Events API

1. En tu Slack App, andá a **Event Subscriptions** → Enable Events
2. Request URL: `https://tu-app.vercel.app/api/slack/events`
3. Slack va a enviar un challenge → tu endpoint lo responde automáticamente
4. En **Subscribe to bot events**, agregá:
   - `message.im` – mensajes directos al bot
   - `app_mention` – cuando mencionan al bot en un canal
5. Guardá los cambios

## Paso 6: Probar

- Abrí un DM con tu bot en Slack y escribí un mensaje
- O mencioná al bot en un canal: `@Antigravity Bot ¿cómo funciona OAuth?`
- Deberías ver el ⏳ y luego la respuesta del agente con ✅

## Verificar estado

Visitá `https://tu-app.vercel.app/api/health` para ver si todo está configurado.

---

## Estructura del proyecto

```
slack-antigravity-bot/
├── api/
│   ├── slack/
│   │   └── events.js      ← Handler principal de eventos de Slack
│   ├── auth/
│   │   └── callback.js     ← Flujo OAuth con Google
│   └── health.js           ← Health check
├── lib/
│   ├── antigravity.js      ← Cliente del gateway Cloud Code
│   ├── slack-verify.js     ← Verificación de firma de Slack
│   └── token-manager.js    ← Gestión de tokens OAuth
├── .env.example
├── package.json
├── vercel.json
└── README.md
```

## Modelos disponibles en Antigravity

Según la documentación del gateway Cloud Code, podés usar:

- `gemini-3-pro` – Modelo principal de Google (recomendado)
- `gemini-3-flash` – Más rápido, ideal para respuestas cortas
- `claude-sonnet-4-6` – Claude de Anthropic
- `claude-sonnet-4-5` – Versión anterior de Claude

El modelo se configura con la env var `ANTIGRAVITY_MODEL`.

## Limitaciones

- **Vercel Free Tier**: funciones serverless tienen timeout de 10 segundos. Si el agente tarda más, puede cortar la respuesta. Considerá upgrade a Pro ($20/mo) si necesitás más tiempo.
- **Cloud Code latency**: el gateway de Antigravity puede tardar 7+ segundos en empezar a responder. Esto es normal.
- **Sin estado entre requests**: cada invocación es independiente. No hay historial de conversación persistente (se puede agregar con Vercel KV o similar).
- **OAuth tokens**: el refresh token no expira mientras no revoques el acceso, pero el access token se renueva automáticamente.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Slack no verifica la URL | Verificá que el deploy esté activo y que la URL sea correcta |
| "Invalid signature" | Revisá que `SLACK_SIGNING_SECRET` sea correcto |
| "OAuth token refresh failed" | Re-hacé el flujo OAuth en `/api/auth/callback` |
| Respuesta vacía del agente | Revisá los logs en Vercel → Deployments → Functions |
| Timeout | El modelo puede tardar >10s. Probá con `gemini-3-flash` que es más rápido |

/**
 * /api/auth/callback.js
 *
 * Endpoint para completar el flujo OAuth con Google.
 * Este flujo te da el refresh_token necesario para que el bot
 * pueda autenticarse con el gateway de Antigravity Cloud Code.
 *
 * USO:
 *   1. Visitá /api/auth/callback?action=login en tu browser
 *   2. Autenticá con tu cuenta de Google (la misma de Antigravity)
 *   3. Copiá los tokens y guardalos en las env vars de Vercel
 */

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ");

module.exports = async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send(`
      <h2>⚠️ Configuración incompleta</h2>
      <p>Configurá las siguientes variables de entorno en Vercel:</p>
      <ul>
        <li>GOOGLE_CLIENT_ID</li>
        <li>GOOGLE_CLIENT_SECRET</li>
        <li>GOOGLE_REDIRECT_URI</li>
      </ul>
    `);
  }

  // ── Paso 1: Iniciar el flujo OAuth ──
  if (req.query.action === "login") {
    const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent"); // Forzar refresh_token

    return res.redirect(authUrl.toString());
  }

  // ── Paso 2: Recibir el authorization code y canjearlo ──
  const code = req.query.code;
  if (!code) {
    return res.status(200).send(`
      <html>
        <head><title>Antigravity OAuth Setup</title></head>
        <body style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px;">
          <h1>🔐 Configuración OAuth de Antigravity</h1>
          <p>Este endpoint te permite obtener los tokens de Google necesarios
             para conectar el bot de Slack con Antigravity Cloud Code.</p>
          <a href="?action=login" 
             style="display:inline-block; padding:12px 24px; background:#4285f4; 
                    color:white; text-decoration:none; border-radius:6px; font-size:16px;">
            Iniciar sesión con Google
          </a>
          <p style="color:#666; margin-top:20px; font-size:14px;">
            Usá la misma cuenta de Google con la que accedés a Antigravity.
          </p>
        </body>
      </html>
    `);
  }

  // Canjear el code por tokens
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const tokens = await tokenRes.json();

    return res.status(200).send(`
      <html>
        <head><title>OAuth Completado</title></head>
        <body style="font-family: system-ui; max-width: 700px; margin: 40px auto; padding: 20px;">
          <h1>✅ Autenticación completada</h1>
          <p>Copiá estos valores y agregalos como variables de entorno en Vercel:</p>
          
          <h3>GOOGLE_ACCESS_TOKEN</h3>
          <textarea readonly rows="3" style="width:100%; font-family:monospace; font-size:12px;">${tokens.access_token}</textarea>
          
          <h3>GOOGLE_REFRESH_TOKEN</h3>
          <textarea readonly rows="3" style="width:100%; font-family:monospace; font-size:12px;">${tokens.refresh_token || "⚠️ No se recibió refresh_token. Revocá el acceso en myaccount.google.com y volvé a autorizar."}</textarea>
          
          <h3>Pasos siguientes:</h3>
          <ol>
            <li>Andá a tu proyecto en <a href="https://vercel.com" target="_blank">Vercel</a></li>
            <li>Settings → Environment Variables</li>
            <li>Agregá <code>GOOGLE_ACCESS_TOKEN</code> y <code>GOOGLE_REFRESH_TOKEN</code></li>
            <li>Redeployá el proyecto</li>
          </ol>
          
          <p style="color:#c00; font-size:14px;">
            ⚠️ Cerrá esta página después de copiar los tokens. 
            No los compartas con nadie.
          </p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("OAuth error:", err);
    return res.status(500).send(`
      <h2>❌ Error en OAuth</h2>
      <p>${err.message}</p>
      <a href="?action=login">Intentar de nuevo</a>
    `);
  }
};

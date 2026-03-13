/**
 * token-manager.js
 * Gestiona el ciclo de vida del access token de Google OAuth.
 *
 * En la capa gratuita de Vercel no hay estado persistente entre
 * invocaciones, así que usamos las env vars como fuente de verdad
 * para el refresh token, y renovamos el access token en cada request.
 *
 * Para producción, podrías usar Vercel KV, Upstash Redis, o similar.
 */

const { refreshAccessToken } = require("./antigravity");

// Cache in-memory (dura lo que dure la instancia serverless)
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Obtiene un access token válido. Lo renueva si expiró.
 */
async function getValidAccessToken() {
  const now = Date.now();

  // Si el token en env está seteado y no tenemos cache, usarlo directamente
  if (process.env.GOOGLE_ACCESS_TOKEN && !cachedToken) {
    cachedToken = process.env.GOOGLE_ACCESS_TOKEN;
    // Asumir que expira en 30 min si no sabemos
    tokenExpiry = now + 30 * 60 * 1000;
  }

  // Si el cache es válido (con 2 min de margen), devolverlo
  if (cachedToken && now < tokenExpiry - 2 * 60 * 1000) {
    return cachedToken;
  }

  // Renovar con refresh token
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      "No hay GOOGLE_REFRESH_TOKEN configurado. " +
        "Completá el flujo OAuth en /api/auth/callback primero."
    );
  }

  console.log("Renovando access token de Google...");
  const result = await refreshAccessToken(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    refreshToken
  );

  cachedToken = result.accessToken;
  tokenExpiry = now + result.expiresIn * 1000;

  return cachedToken;
}

module.exports = { getValidAccessToken };

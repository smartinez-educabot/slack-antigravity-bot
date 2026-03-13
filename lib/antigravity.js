/**
 * antigravity.js
 * Cliente para el gateway unificado de Google Antigravity (Cloud Code).
 *
 * Antigravity expone modelos (Gemini, Claude, GPT-OSS) a través de un
 * endpoint interno con formato Gemini-style, autenticado vía OAuth2.
 *
 * Endpoints conocidos:
 *   - Producción : https://cloudcode-pa.googleapis.com
 *   - Daily/Sandbox: https://daily-cloudcode-pa.sandbox.googleapis.com
 */

const ENDPOINTS = {
  production: "https://cloudcode-pa.googleapis.com",
  daily: "https://daily-cloudcode-pa.sandbox.googleapis.com",
};

/**
 * Refresca el access token usando el refresh token.
 */
async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth token refresh failed: ${res.status} – ${err}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Envía un mensaje al agente de Antigravity y devuelve la respuesta de texto.
 *
 * @param {object} opts
 * @param {string} opts.accessToken  – Bearer token de Google OAuth
 * @param {string} opts.model        – Ej: "gemini-3-pro", "claude-sonnet-4-6"
 * @param {string} opts.projectId    – Project ID de Antigravity
 * @param {string} opts.userMessage  – Mensaje del usuario
 * @param {string} [opts.systemPrompt] – Instrucciones de sistema para el agente
 * @param {Array}  [opts.history]    – Historial de conversación previo
 * @param {string} [opts.env]        – "production" | "daily" (default: "daily")
 * @returns {Promise<{text: string, raw: object}>}
 */
async function sendMessage({
  accessToken,
  model,
  projectId,
  userMessage,
  systemPrompt,
  history = [],
  env = "daily",
}) {
  const endpoint = ENDPOINTS[env] || ENDPOINTS.daily;

  // Construir el array de contents (historial + mensaje nuevo)
  const contents = [
    ...history,
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  // Construir el body en formato Antigravity/Gemini-style
  const body = {
    project: projectId,
    model: model,
    request: {
      contents,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      },
    },
    userAgent: "antigravity",
    requestId: `slack-bot-${Date.now()}`,
  };

  // Agregar system instruction si se provee
  if (systemPrompt) {
    body.request.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const url = `${endpoint}/v1/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "antigravity/1.15.8",
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": JSON.stringify({
        ideType: "ANTIGRAVITY",
        platform: "LINUX",
        pluginType: "GEMINI",
      }),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `Antigravity API error (${res.status}): ${errBody.substring(0, 500)}`
    );
  }

  const data = await res.json();

  // Extraer texto de la respuesta (formato candidates[])
  const text = extractTextFromResponse(data);

  return { text, raw: data };
}

/**
 * Extrae el texto de la respuesta de Antigravity.
 * La respuesta viene en formato Gemini: { candidates: [{ content: { parts: [...] } }] }
 */
function extractTextFromResponse(data) {
  try {
    if (data.candidates && data.candidates.length > 0) {
      const parts = data.candidates[0].content?.parts || [];
      return parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n");
    }

    // Fallback: formato Anthropic (si el modelo es Claude)
    if (data.content && Array.isArray(data.content)) {
      return data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }

    return "No pude generar una respuesta. Intentá de nuevo.";
  } catch (e) {
    console.error("Error parsing Antigravity response:", e);
    return "Error al procesar la respuesta del agente.";
  }
}

module.exports = {
  sendMessage,
  refreshAccessToken,
  extractTextFromResponse,
  ENDPOINTS,
};

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
 *
 * La URL correcta del endpoint es:
 *   POST {base}/v1internal/generate
 * con el modelo especificado dentro del body, no en la URL.
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
  const requestBody = {
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
    requestBody.request.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  // Intentar múltiples formatos de URL conocidos
  const urlCandidates = [
    `${endpoint}/v1internal/generate`,
    `${endpoint}/v1/generate`,
    `${endpoint}/v1beta/models/${model}:generateContent`,
    `${endpoint}/v1/models/${model}:generateContent`,
  ];

  let lastError = null;

  for (const url of urlCandidates) {
    console.log(`Trying Antigravity URL: ${url}`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "antigravity/1.15.8",
          "X-Goog-Api-Client":
            "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": JSON.stringify({
            ideType: "ANTIGRAVITY",
            platform: "LINUX",
            pluginType: "GEMINI",
          }),
        },
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        const data = await res.json();
        const text = extractTextFromResponse(data);
        console.log(`Success with URL: ${url}`);
        return { text, raw: data };
      }

      // Si es 404, probar la siguiente URL
      if (res.status === 404) {
        console.log(`404 on ${url}, trying next...`);
        lastError = `404 on ${url}`;
        continue;
      }

      // Otros errores → reportar
      const errBody = await res.text();
      lastError = `Antigravity API error (${res.status}): ${errBody.substring(0, 300)}`;
      console.error(lastError);

      // Si es 401/403, no tiene sentido probar otras URLs
      if (res.status === 401 || res.status === 403) {
        throw new Error(lastError);
      }

      continue;
    } catch (fetchErr) {
      if (fetchErr.message.includes("Antigravity API error")) {
        throw fetchErr;
      }
      lastError = fetchErr.message;
      console.error(`Fetch error on ${url}:`, lastError);
      continue;
    }
  }

  // Si ninguna URL funcionó, intentar como Vertex AI estándar (fallback)
  console.log("All Antigravity URLs failed, trying Vertex AI format...");
  const vertexUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const vertexBody = {
    contents,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
  };

  if (systemPrompt) {
    vertexBody.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const vertexRes = await fetch(vertexUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(vertexBody),
  });

  if (vertexRes.ok) {
    const data = await vertexRes.json();
    const text = extractTextFromResponse(data);
    console.log("Success with Vertex AI fallback");
    return { text, raw: data };
  }

  const vertexErr = await vertexRes.text();
  throw new Error(
    `All API endpoints failed. Last Antigravity error: ${lastError}. Vertex fallback error (${vertexRes.status}): ${vertexErr.substring(0, 300)}`
  );
}

/**
 * Extrae el texto de la respuesta.
 * Soporta formato Gemini (candidates[]) y Anthropic (content[]).
 */
function extractTextFromResponse(data) {
  try {
    // Formato Gemini: { candidates: [{ content: { parts: [...] } }] }
    if (data.candidates && data.candidates.length > 0) {
      const parts = data.candidates[0].content?.parts || [];
      return parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n");
    }

    // Formato Anthropic: { content: [{ type: "text", text: "..." }] }
    if (data.content && Array.isArray(data.content)) {
      return data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }

    // Fallback: buscar text en la respuesta
    if (data.text) return data.text;
    if (data.response) return typeof data.response === "string" ? data.response : JSON.stringify(data.response);

    console.warn("Unknown response format:", JSON.stringify(data).substring(0, 500));
    return "No pude generar una respuesta. Intentá de nuevo.";
  } catch (e) {
    console.error("Error parsing response:", e);
    return "Error al procesar la respuesta del agente.";
  }
}

module.exports = {
  sendMessage,
  refreshAccessToken,
  extractTextFromResponse,
  ENDPOINTS,
};

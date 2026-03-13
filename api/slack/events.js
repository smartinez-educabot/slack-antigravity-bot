/**
 * /api/slack/events.js
 *
 * Endpoint principal que recibe eventos de Slack (Events API).
 * Cuando alguien envía un mensaje al bot, este handler:
 *   1. Verifica la firma de Slack
 *   2. Responde al URL verification challenge
 *   3. Envía el mensaje al agente de Antigravity
 *   4. Postea la respuesta de vuelta en Slack
 *
 * Compatible con Vercel Free Tier (max 10s de ejecución).
 */

const { WebClient } = require("@slack/web-api");
const { verifySlackSignature } = require("../../lib/slack-verify");
const { sendMessage } = require("../../lib/antigravity");
const { getValidAccessToken } = require("../../lib/token-manager");

module.exports = async function handler(req, res) {
  // Solo aceptar POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Leer el raw body para verificación ──
  const rawBody =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  // ── 2. Verificar firma de Slack ──
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (signingSecret) {
    const isValid = verifySlackSignature({
      signingSecret,
      signature: req.headers["x-slack-signature"] || "",
      timestamp: req.headers["x-slack-request-timestamp"] || "",
      body: rawBody,
    });

    if (!isValid) {
      console.warn("Invalid Slack signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  // ── 3. URL Verification (Slack lo envía al configurar Events API) ──
  if (body.type === "url_verification") {
    console.log("Slack URL verification challenge received");
    return res.status(200).json({ challenge: body.challenge });
  }

  // ── 4. Procesar eventos ──
  if (body.type === "event_callback") {
    const event = body.event;

    // Ignorar mensajes del propio bot (evitar loops)
    if (event.bot_id || event.subtype === "bot_message") {
      return res.status(200).json({ ok: true });
    }

    // Solo procesar mensajes directos (DMs) o menciones al bot
    const isDirectMessage = event.channel_type === "im";
    const isMention =
      event.type === "app_mention" ||
      (event.text && event.text.includes(`<@${body.authorizations?.[0]?.user_id}>`));

    if (event.type === "message" && !isDirectMessage && !isMention) {
      // Mensaje en canal pero sin mención → ignorar
      return res.status(200).json({ ok: true });
    }

    if (
      (event.type === "message" && (isDirectMessage || isMention)) ||
      event.type === "app_mention"
    ) {
      // Responder 200 inmediatamente para que Slack no reintente
      // Nota: En Vercel Free Tier, el procesamiento continúa después del res.send
      // siempre que no exceda el timeout de la función.
      res.status(200).json({ ok: true });

      try {
        await processMessage(event);
      } catch (err) {
        console.error("Error processing message:", err);
        // Intentar notificar al usuario del error
        try {
          const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
          await slack.chat.postMessage({
            channel: event.channel,
            thread_ts: event.thread_ts || event.ts,
            text: `⚠️ Hubo un error al procesar tu mensaje. Intentá de nuevo en unos segundos.\n_Error: ${err.message}_`,
          });
        } catch (_) {
          // Silenciar error secundario
        }
      }

      return;
    }
  }

  // Evento no manejado
  return res.status(200).json({ ok: true });
};

/**
 * Procesa un mensaje de Slack y envía la respuesta del agente.
 */
async function processMessage(event) {
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  // Limpiar el texto (remover la mención al bot)
  let userMessage = event.text || "";
  userMessage = userMessage.replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!userMessage) {
    await slack.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: "¡Hola! Enviame un mensaje y lo proceso con el agente. 🤖",
    });
    return;
  }

  // Indicador de "escribiendo..." (reacción)
  try {
    await slack.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });
  } catch (_) {
    // No es crítico si falla
  }

  // Obtener token válido de Google
  const accessToken = await getValidAccessToken();

  // Llamar al agente de Antigravity
  const { text: agentResponse } = await sendMessage({
    accessToken,
    model: process.env.ANTIGRAVITY_MODEL || "gemini-3-pro",
    projectId:
      process.env.ANTIGRAVITY_PROJECT_ID || "rising-fact-p41fc",
    userMessage,
    systemPrompt: process.env.AGENT_SYSTEM_PROMPT || undefined,
    env: process.env.ANTIGRAVITY_ENV || "daily",
  });

  // Enviar respuesta en Slack
  await slack.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts || event.ts,
    text: agentResponse,
    // Usar mrkdwn para formato rico
    mrkdwn: true,
  });

  // Quitar el indicador de "escribiendo..."
  try {
    await slack.reactions.remove({
      channel: event.channel,
      timestamp: event.ts,
      name: "hourglass_flowing_sand",
    });
    await slack.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "white_check_mark",
    });
  } catch (_) {
    // No es crítico
  }
}

/**
 * /api/health.js
 * Health check para verificar que todo esté configurado.
 */

module.exports = async function handler(req, res) {
  const checks = {
    slack_bot_token: !!process.env.SLACK_BOT_TOKEN,
    slack_signing_secret: !!process.env.SLACK_SIGNING_SECRET,
    google_client_id: !!process.env.GOOGLE_CLIENT_ID,
    google_refresh_token: !!process.env.GOOGLE_REFRESH_TOKEN,
    antigravity_model: process.env.ANTIGRAVITY_MODEL || "not set (default: gemini-3-pro)",
  };

  const allGood = checks.slack_bot_token && checks.slack_signing_secret && 
                  checks.google_client_id && checks.google_refresh_token;

  res.status(allGood ? 200 : 503).json({
    status: allGood ? "healthy" : "missing_config",
    checks,
    timestamp: new Date().toISOString(),
  });
};

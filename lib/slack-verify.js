/**
 * slack-verify.js
 * Verifica que los requests provengan realmente de Slack
 * usando el Signing Secret (HMAC-SHA256).
 */

const crypto = require("crypto");

/**
 * Verifica la firma de un request de Slack.
 *
 * @param {object} opts
 * @param {string} opts.signingSecret - Slack Signing Secret
 * @param {string} opts.signature     - Header x-slack-signature
 * @param {string} opts.timestamp     - Header x-slack-request-timestamp
 * @param {string} opts.body          - Raw body del request (string)
 * @returns {boolean}
 */
function verifySlackSignature({ signingSecret, signature, timestamp, body }) {
  // Protección contra replay attacks (5 minutos)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    console.warn("Slack request too old, possible replay attack");
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBasestring, "utf8")
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

module.exports = { verifySlackSignature };

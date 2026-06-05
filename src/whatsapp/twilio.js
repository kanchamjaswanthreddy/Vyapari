const twilio = require('twilio');
require('dotenv').config();

let _client = null;
function getClient() {
  if (!_client) {
    _client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

const FROM = 'whatsapp:+14155238886'; // Twilio sandbox number

/**
 * Send a plain text WhatsApp message via Twilio.
 */
async function sendText(to, text) {
  // Ensure number is in whatsapp: format
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  await getClient().messages.create({
    from: FROM,
    to: toFormatted,
    body: text,
  });
}

/**
 * Twilio doesn't support interactive buttons in sandbox.
 * Fall back to plain text with numbered options.
 */
async function sendButtons(to, bodyText, buttons) {
  const options = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
  await sendText(to, `${bodyText}\n\n${options}`);
}

/**
 * Download media from Twilio's media URL.
 * Returns buffer + mimeType.
 */
async function downloadMedia(mediaUrl) {
  const axios = require('axios');
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
  });
  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers['content-type'] || 'image/jpeg',
  };
}

module.exports = { sendText, sendButtons, downloadMedia };

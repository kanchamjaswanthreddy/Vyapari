/**
 * WhatsApp send adapter.
 * Routes to Twilio or Meta Cloud API based on WHATSAPP_PROVIDER env var.
 * Default: twilio (for sandbox testing without business verification)
 */

const provider = (process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();

let adapter;
if (provider === 'meta') {
  adapter = require('./meta');
} else {
  adapter = require('./twilio');
}

module.exports = {
  sendText: adapter.sendText,
  sendButtons: adapter.sendButtons,
  downloadMedia: adapter.downloadMedia,
};

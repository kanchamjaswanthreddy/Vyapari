const axios = require('axios');
require('dotenv').config();

const META_API_URL = `https://graph.facebook.com/v21.0/${process.env.META_PHONE_ID}/messages`;

async function sendText(to, text) {
  try {
    const response = await axios.post(META_API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }, {
      headers: {
        Authorization: `Bearer ${process.env.META_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (err) {
    console.error('Meta sendText failed:', err.response?.data || err.message);
    throw err;
  }
}

async function sendButtons(to, bodyText, buttons) {
  const buttonList = buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } }));
  try {
    await axios.post(META_API_URL, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: { type: 'button', body: { text: bodyText }, action: { buttons: buttonList } },
    }, {
      headers: { Authorization: `Bearer ${process.env.META_TOKEN}`, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    await sendText(to, bodyText + '\n\nOptions: ' + buttons.map((b) => b.title).join(' / '));
  }
}

async function downloadMedia(mediaId) {
  const { data: urlData } = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.META_TOKEN}` },
  });
  const { data: fileBuffer } = await axios.get(urlData.url, {
    headers: { Authorization: `Bearer ${process.env.META_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return { buffer: Buffer.from(fileBuffer), mimeType: urlData.mime_type };
}

module.exports = { sendText, sendButtons, downloadMedia };

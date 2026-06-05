const axios = require('axios');
require('dotenv').config();

const META_API_URL = `https://graph.facebook.com/v21.0/${process.env.META_PHONE_ID}/messages`;

/**
 * Send a plain text WhatsApp message via Meta Cloud API.
 */
async function sendText(to, text) {
  try {
    const response = await axios.post(
      META_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('sendText failed:', JSON.stringify(detail));
    throw err;
  }
}

/**
 * Send a message with interactive button replies.
 * buttons: [{ id: 'reorder_now', title: 'Reorder Now' }, ...]
 */
async function sendButtons(to, bodyText, buttons) {
  const buttonList = buttons.map((b) => ({
    type: 'reply',
    reply: { id: b.id, title: b.title },
  }));

  try {
    const response = await axios.post(
      META_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: buttonList },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('sendButtons failed:', JSON.stringify(detail));
    // Fallback to plain text if buttons fail
    await sendText(to, bodyText + '\n\nOptions: ' + buttons.map((b) => b.title).join(' / '));
  }
}

/**
 * Download media from Meta's servers using the media ID.
 * Returns a Buffer of the file content.
 */
async function downloadMedia(mediaId) {
  // Step 1: get the URL
  const { data: urlData } = await axios.get(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${process.env.META_TOKEN}` },
    }
  );

  // Step 2: download the actual file
  const { data: fileBuffer } = await axios.get(urlData.url, {
    headers: { Authorization: `Bearer ${process.env.META_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return { buffer: Buffer.from(fileBuffer), mimeType: urlData.mime_type };
}

module.exports = { sendText, sendButtons, downloadMedia };

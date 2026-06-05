const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

/**
 * Transcribe audio using OpenAI Whisper API.
 * @param {Buffer} audioBuffer - audio file buffer
 * @param {string} filename - e.g. 'audio.ogg'
 * @returns {string} transcribed text
 */
async function transcribeAudio(audioBuffer, filename = 'audio.ogg') {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set — voice transcription unavailable');
  }

  const form = new FormData();
  form.append('file', audioBuffer, {
    filename,
    contentType: 'audio/ogg',
  });
  form.append('model', 'whisper-1');
  form.append('language', 'hi'); // Hindi + Telugu + English mixed

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
    }
  );

  return response.data.text || '';
}

module.exports = { transcribeAudio };

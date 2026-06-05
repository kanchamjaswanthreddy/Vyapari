require('dotenv').config();
const express = require('express');
const { handleIncomingMessage } = require('./webhook');
const { handleTwilioMessage } = require('./webhook-twilio');
const { startLowStockJob } = require('./jobs/lowStockCheck');
const { startDailySummaryJob } = require('./jobs/dailySummary');
const { logError } = require('./db/supabase');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // needed for Twilio form POST

const PORT = process.env.PORT || 3000;
const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();

// --- Health check ---
app.get('/', (req, res) => {
  res.json({ status: 'ok', name: 'Vyapari', tagline: 'Smart Vyapari, Simple Dukan', provider: PROVIDER });
});

// --- Meta Webhook Verification (GET) ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Webhook] Meta verified successfully');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Incoming WhatsApp Messages (POST) ---
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always respond immediately

  try {
    if (PROVIDER === 'twilio') {
      await handleTwilioMessage(req.body);
    } else {
      await handleIncomingMessage(req.body);
    }
  } catch (err) {
    console.error('[Webhook] Unhandled error:', err.message);
    await logError(null, 'UNHANDLED_WEBHOOK_ERROR', req.body, err.message).catch(() => {});
  }
});

// --- Start Background Jobs ---
startLowStockJob();
startDailySummaryJob();

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n🚀 Vyapari running on port ${PORT} [provider: ${PROVIDER}]`);
  console.log(`   Smart Vyapari, Simple Dukan\n`);
});

module.exports = app;

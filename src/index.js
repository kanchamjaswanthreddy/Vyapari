require('dotenv').config();
const express = require('express');
const { handleIncomingMessage } = require('./webhook');
const { startLowStockJob } = require('./jobs/lowStockCheck');
const { startDailySummaryJob } = require('./jobs/dailySummary');
const { logError } = require('./db/supabase');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Health check ---
app.get('/', (req, res) => {
  res.json({ status: 'ok', name: 'Vyapari', tagline: 'Smart Vyapari, Simple Dukan' });
});

// --- Meta Webhook Verification ---
// GET /webhook is called by Meta to verify the endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed — token mismatch');
  return res.sendStatus(403);
});

// --- Incoming WhatsApp Messages ---
// POST /webhook receives all incoming messages and status updates
app.post('/webhook', async (req, res) => {
  // Acknowledge immediately — Meta requires 200 within 5 seconds
  res.sendStatus(200);

  try {
    await handleIncomingMessage(req.body);
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
  console.log(`\n🚀 Vyapari server running on port ${PORT}`);
  console.log(`   Smart Vyapari, Simple Dukan\n`);
});

module.exports = app;

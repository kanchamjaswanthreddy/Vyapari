/**
 * Twilio webhook adapter.
 * Converts Twilio's form-encoded payload into the same internal message format
 * that the core webhook.js handlers expect, then delegates to them.
 */

const db = require('./db/supabase');
const { sendText } = require('./whatsapp/send');
const { detectIntent, INTENTS } = require('./router');
const { handleOnboarding } = require('./states/onboarding');
const { handleBillPhoto } = require('./states/billPhoto');
const {
  handleStockOut,
  handleVoiceOut,
  handleAmbiguousClarification,
  handleUndo,
  handleUndoConfirm,
} = require('./states/stockOut');
const {
  handleUdhaarCredit,
  handleUdhaarPayment,
  handleCheckBalance,
  handleUdhaarList,
} = require('./states/udhaar');
const {
  handleReorderStart,
  handleReorderQty,
  handleSupplierConfirm,
  handleSnooze,
} = require('./states/reorder');
const { sendStoreSummary } = require('./jobs/dailySummary');
const MESSAGES = require('./messages');

/**
 * Convert a Twilio form POST body into our internal message format.
 * Twilio fields: From, Body, NumMedia, MediaUrl0, MediaContentType0
 */
function parseTwilioBody(body) {
  // From looks like: whatsapp:+919876543210 — strip the prefix
  const fromRaw = body.From || '';
  const fromNumber = fromRaw.replace('whatsapp:', '');

  const numMedia = parseInt(body.NumMedia || '0', 10);
  const hasImage =
    numMedia > 0 &&
    (body.MediaContentType0 || '').startsWith('image/');
  const hasAudio =
    numMedia > 0 &&
    (body.MediaContentType0 || '').startsWith('audio/');

  let message;

  if (hasImage) {
    // Image message — pass media URL as the ID (twilio.js downloadMedia handles auth)
    message = {
      type: 'image',
      image: { id: body.MediaUrl0, mime_type: body.MediaContentType0 },
      from: fromNumber,
    };
  } else if (hasAudio) {
    message = {
      type: 'audio',
      audio: { id: body.MediaUrl0 },
      from: fromNumber,
    };
  } else {
    // Plain text
    message = {
      type: 'text',
      text: { body: body.Body || '' },
      from: fromNumber,
    };
  }

  return { fromNumber, message };
}

/**
 * Main Twilio message handler — same logic as Meta webhook.js.
 */
async function handleTwilioMessage(body) {
  const { fromNumber, message } = parseTwilioBody(body);

  if (!fromNumber) return;

  console.log(`[Twilio] Incoming from ${fromNumber}: ${message.text?.body || message.type}`);

  let store = null;
  try {
    store = await db.getStoreByPhone(fromNumber);
  } catch (err) {
    console.error('DB lookup failed:', err.message);
    await db.logError(null, 'DB_LOOKUP_ERROR', { fromNumber }, err.message);
    return;
  }

  // Onboarding states
  const onboardingStates = [
    'ONBOARDING_NAME', 'ONBOARDING_SHOP', 'ONBOARDING_CITY',
    'ONBOARDING_SUPPLIER', 'ONBOARDING_PRODUCTS', 'ONBOARDING_THRESHOLDS',
  ];

  if (!store || onboardingStates.includes(store.conversation_state)) {
    try {
      await handleOnboarding(store, message, fromNumber);
    } catch (err) {
      console.error('Onboarding error:', err.message);
      await db.logError(store?.id, 'ONBOARDING_ERROR', { message }, err.message);
      await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    }
    return;
  }

  const state = store.conversation_state;

  // Mid-flow states
  try {
    if (state === 'AWAITING_BILL_CONFIRM') {
      await handleBillPhoto(store, message, fromNumber);
      return;
    }
    if (state === 'AWAITING_REORDER_QTY') {
      await handleReorderQty(store, message, fromNumber);
      return;
    }
    if (state === 'AWAITING_SUPPLIER_CONFIRM') {
      await handleSupplierConfirm(store, message, fromNumber);
      return;
    }
    if (state === 'AWAITING_CORRECTION') {
      const stateData = store.state_data || {};
      if (stateData.type === 'stock_out_clarify') {
        await handleAmbiguousClarification(store, message, fromNumber);
        return;
      }
      if (stateData.type === 'undo_confirm') {
        await handleUndoConfirm(store, message, fromNumber);
        return;
      }
    }
  } catch (err) {
    console.error(`State ${state} error:`, err.message);
    await db.logError(store.id, `STATE_${state}_ERROR`, { message }, err.message);
    await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    await db.updateConversationState(store.id, 'IDLE', {});
    return;
  }

  // IDLE — detect intent and route
  if (state === 'IDLE') {
    const intent = detectIntent(message);
    console.log(`[Twilio] Intent: ${intent}`);

    try {
      switch (intent) {
        case INTENTS.BILL_PHOTO:
          await handleBillPhoto(store, message, fromNumber);
          break;

        case 'VOICE_OUT':
          await handleVoiceOut(store, message, fromNumber);
          break;

        case INTENTS.STOCK_OUT:
          await handleStockOut(store, message, fromNumber);
          break;

        case INTENTS.UDHAAR_CREDIT:
          await handleUdhaarCredit(store, message, fromNumber);
          break;

        case INTENTS.UDHAAR_PAYMENT:
          await handleUdhaarPayment(store, message, fromNumber);
          break;

        case INTENTS.UDHAAR_LIST:
          await handleUdhaarList(store, fromNumber);
          break;

        case INTENTS.CHECK_BALANCE:
          await handleCheckBalance(store, message, fromNumber);
          break;

        case INTENTS.SUMMARY:
          await sendStoreSummary(store);
          break;

        case INTENTS.UNDO:
          await handleUndo(store, fromNumber);
          break;

        case INTENTS.CHECK_STOCK: {
          const products = await db.getProducts(store.id);
          if (!products.length) {
            await sendText(fromNumber, 'Koi product nahi mila. Bill photo bhejo products add karne ke liye.');
          } else {
            const list = products.map((p) => `– ${p.name}: ${p.current_stock} ${p.unit}`).join('\n');
            await sendText(fromNumber, `Stock:\n\n${list}`);
          }
          break;
        }

        case INTENTS.HELP:
          await sendText(fromNumber, MESSAGES.HELP);
          break;

        default:
          await sendText(fromNumber, MESSAGES.UNKNOWN_COMMAND);
      }
    } catch (err) {
      console.error(`Intent ${intent} error:`, err.message);
      await db.logError(store.id, `INTENT_${intent}_ERROR`, { message }, err.message);
      await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    }
  }
}

module.exports = { handleTwilioMessage };

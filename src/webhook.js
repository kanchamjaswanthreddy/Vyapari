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
 * Extract the first message from a Meta webhook payload.
 * Returns { fromNumber, message } or null if no message found.
 */
function extractMessage(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return null;

    const message = value.messages[0];
    const fromNumber = message.from;

    return { fromNumber, message };
  } catch {
    return null;
  }
}

/**
 * Main webhook handler — called for every incoming WhatsApp message.
 */
async function handleIncomingMessage(body) {
  const extracted = extractMessage(body);
  if (!extracted) return;

  const { fromNumber, message } = extracted;

  let store = null;
  try {
    store = await db.getStoreByPhone(fromNumber);
  } catch (err) {
    console.error('DB lookup failed:', err.message);
    await db.logError(null, 'DB_LOOKUP_ERROR', { fromNumber }, err.message);
    return;
  }

  // New user — start onboarding
  if (!store || store.conversation_state === 'ONBOARDING_NAME' ||
      store.conversation_state === 'ONBOARDING_SHOP' ||
      store.conversation_state === 'ONBOARDING_CITY' ||
      store.conversation_state === 'ONBOARDING_SUPPLIER' ||
      store.conversation_state === 'ONBOARDING_PRODUCTS' ||
      store.conversation_state === 'ONBOARDING_THRESHOLDS') {
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

  // Handle mid-flow states first
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
    console.error(`State ${state} handler error:`, err.message);
    await db.logError(store.id, `STATE_${state}_ERROR`, { message }, err.message);
    await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    await db.updateConversationState(store.id, 'IDLE', {});
    return;
  }

  // IDLE state — detect intent
  if (state === 'IDLE') {
    const intent = detectIntent(message);

    try {
      switch (intent) {
        case INTENTS.BILL_PHOTO:
          await handleBillPhoto(store, message, fromNumber);
          break;

        case 'VOICE_OUT':
          await handleVoiceOut(store, message, fromNumber);
          break;

        case 'BUTTON_REORDER': {
          const productId = message.interactive.button_reply.id.replace('reorder_', '');
          await handleReorderStart(store, productId, fromNumber);
          break;
        }

        case 'BUTTON_SNOOZE': {
          const productId = message.interactive.button_reply.id.replace('snooze_', '');
          await handleSnooze(store, productId, fromNumber);
          break;
        }

        case 'BUTTON_THRESHOLD':
          await sendText(fromNumber, 'Naya threshold batao. Example: cement 15');
          await db.updateConversationState(store.id, 'AWAITING_CORRECTION', {
            type: 'update_threshold',
            product_id: message.interactive.button_reply.id.replace('threshold_', ''),
          });
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
          const { getProducts } = require('./db/supabase');
          const products = await getProducts(store.id);
          if (!products.length) {
            await sendText(fromNumber, 'Koi product nahi mila. Bill photo bhejo products add karne ke liye.');
          } else {
            const list = products.map((p) => `– ${p.name}: ${p.current_stock} ${p.unit}`).join('\n');
            await sendText(fromNumber, `📦 Current Stock:\n\n${list}`);
          }
          break;
        }

        case INTENTS.HELP:
          await sendText(fromNumber, MESSAGES.HELP);
          break;

        case INTENTS.ADD_PRODUCT:
          await sendText(fromNumber, 'Naya product add karne ke liye batao: naam aur unit\nExample: rice kg');
          break;

        case INTENTS.ADD_SUPPLIER:
          await sendText(fromNumber, 'Naya supplier add karne ke liye batao: naam aur number\nExample: Ramesh Traders, 9876543210');
          break;

        default:
          await sendText(fromNumber, MESSAGES.UNKNOWN_COMMAND);
      }
    } catch (err) {
      console.error(`Intent ${intent} handler error:`, err.message);
      await db.logError(store.id, `INTENT_${intent}_ERROR`, { message }, err.message);
      await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    }
  }
}

module.exports = { handleIncomingMessage, extractMessage };

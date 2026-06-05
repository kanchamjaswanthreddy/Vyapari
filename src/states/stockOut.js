const db = require('../db/supabase');
const { sendText } = require('../whatsapp/send');
const { parseStockOutText } = require('../ai/vision');
const { transcribeAudio } = require('../ai/transcribe');
const { downloadMedia } = require('../whatsapp/send');
const MESSAGES = require('../messages');

/**
 * Quick regex parser for stock out messages.
 * Handles: "sold 3 cement bags", "2 steel rods ravi ko", "becha 5 pipe"
 */
function quickParseStockOut(text) {
  // Pattern: optional verb + number + product + optional customer
  const pattern = /(?:sold|becha|nikala|sell|gaya|diya)?\s*(\d+(?:\.\d+)?)\s+(.+?)(?:\s+(?:ko|to|for)\s+(.+))?$/i;
  const match = text.trim().match(pattern);
  if (!match) return null;
  return {
    quantity: parseFloat(match[1]),
    product_name: match[2].trim(),
    customer_name: match[3]?.trim() || null,
  };
}

/**
 * Get time ago string for undo confirmation.
 */
function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

/**
 * Handle stock OUT text message.
 */
async function handleStockOut(store, message, fromNumber) {
  const text = message.text?.body?.trim() || '';
  const storeProducts = await db.getProducts(store.id);

  // Try quick parse first
  let parsed = quickParseStockOut(text);

  // Fall back to AI parse if quick parse fails
  if (!parsed && storeProducts.length) {
    parsed = await parseStockOutText(text, storeProducts);
  }

  if (!parsed || !parsed.product_name || !parsed.quantity) {
    await sendText(fromNumber, MESSAGES.UNKNOWN_COMMAND);
    return;
  }

  // Find matching products
  const matches = storeProducts.filter((p) =>
    p.name.toLowerCase().includes(parsed.product_name.toLowerCase())
  );

  if (!matches.length) {
    await sendText(fromNumber, MESSAGES.UNKNOWN_PRODUCT(parsed.product_name));
    return;
  }

  // Multiple matches — ask clarification
  if (matches.length > 1) {
    await db.updateConversationState(store.id, 'AWAITING_CORRECTION', {
      type: 'stock_out_clarify',
      quantity: parsed.quantity,
      customer_name: parsed.customer_name,
      matches: matches.map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    });
    await sendText(fromNumber, MESSAGES.AMBIGUOUS_PRODUCT(matches));
    return;
  }

  // Exactly one match — process OUT
  await processStockOut(store, matches[0], parsed.quantity, parsed.customer_name, fromNumber);
}

/**
 * Handle voice message for stock out.
 */
async function handleVoiceOut(store, message, fromNumber) {
  try {
    const mediaId = message.audio?.id;
    if (!mediaId) throw new Error('No audio media ID');

    const { buffer } = await downloadMedia(mediaId);
    const transcript = await transcribeAudio(buffer);

    if (!transcript) {
      await sendText(fromNumber, 'Voice message samajh nahi aaya — please text karein.');
      return;
    }

    // Parse transcript like a text message
    await handleStockOut(store, { text: { body: transcript } }, fromNumber);
  } catch (err) {
    console.error('Voice transcription failed:', err.message);
    await sendText(fromNumber, 'Voice message process nahi ho paaya — please text karein.');
  }
}

/**
 * Handle clarification response (numbered choice for ambiguous product).
 */
async function handleAmbiguousClarification(store, message, fromNumber) {
  const text = message.text?.body?.trim() || '';
  const stateData = store.state_data || {};
  const num = parseInt(text);

  if (!stateData.matches || isNaN(num) || num < 1 || num > stateData.matches.length) {
    await sendText(fromNumber, `1 se ${stateData.matches?.length || 1} ke beech number bhejo.`);
    return;
  }

  const chosen = stateData.matches[num - 1];
  const storeProducts = await db.getProducts(store.id);
  const product = storeProducts.find((p) => p.id === chosen.id);

  if (!product) {
    await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    await db.updateConversationState(store.id, 'IDLE', {});
    return;
  }

  await processStockOut(store, product, stateData.quantity, stateData.customer_name, fromNumber);
}

/**
 * Handle undo last entry.
 */
async function handleUndo(store, fromNumber) {
  const last = await db.getLastMovement(store.id);

  if (!last) {
    await sendText(fromNumber, MESSAGES.UNDO_NOTHING);
    return;
  }

  const ago = timeAgo(last.created_at);
  await db.updateConversationState(store.id, 'AWAITING_CORRECTION', {
    type: 'undo_confirm',
    movement_id: last.id,
    product_id: last.product_id,
    product_name: last.products?.name,
    quantity: last.quantity,
    movement_type: last.movement_type,
    unit: last.products?.unit,
    time_ago: ago,
  });

  await sendText(
    fromNumber,
    MESSAGES.UNDO_CONFIRM({
      quantity: last.quantity,
      product_name: last.products?.name,
      movement_type: last.movement_type,
      time_ago: ago,
    })
  );
}

/**
 * Handle undo confirmation.
 */
async function handleUndoConfirm(store, message, fromNumber) {
  const text = message.text?.body?.trim().toLowerCase() || '';
  const stateData = store.state_data || {};

  if (!['haan', 'han', 'yes', 'ok', 'ha'].some((w) => text.includes(w))) {
    await db.updateConversationState(store.id, 'IDLE', {});
    await sendText(fromNumber, 'Theek hai, koi changes nahi kiye.');
    return;
  }

  // Reverse the movement
  const delta = stateData.movement_type === 'OUT' ? stateData.quantity : -stateData.quantity;
  const newStock = await db.undoMovement(stateData.movement_id, stateData.product_id, delta);

  await db.updateConversationState(store.id, 'IDLE', {});
  await sendText(
    fromNumber,
    MESSAGES.UNDO_DONE(stateData.product_name, stateData.quantity, stateData.unit, newStock)
  );
}

/**
 * Core function: deduct stock and record movement.
 */
async function processStockOut(store, product, quantity, customerName, fromNumber) {
  const newStock = Math.max(0, Number(product.current_stock) - Number(quantity));

  await db.updateProductStock(product.id, newStock);
  await db.createStockMovement({
    store_id: store.id,
    product_id: product.id,
    movement_type: 'OUT',
    quantity,
    source: 'text',
    customer_name: customerName || null,
  });

  await db.updateConversationState(store.id, 'IDLE', {});
  await sendText(
    fromNumber,
    MESSAGES.STOCK_OUT_CONFIRM(product.name, quantity, product.unit, newStock, customerName)
  );
}

module.exports = { handleStockOut, handleVoiceOut, handleAmbiguousClarification, handleUndo, handleUndoConfirm };

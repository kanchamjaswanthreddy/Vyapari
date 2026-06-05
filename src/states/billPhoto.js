const db = require('../db/supabase');
const { sendText } = require('../whatsapp/send');
const { parseBillImage } = require('../ai/vision');
const { downloadMedia } = require('../whatsapp/send');
const MESSAGES = require('../messages');

/**
 * Handle bill photo flow.
 * Called when message type === 'image' or state === 'AWAITING_BILL_CONFIRM'.
 */
async function handleBillPhoto(store, message, fromNumber) {
  // Step 1: New image received — parse with AI
  if (message.type === 'image') {
    await sendText(fromNumber, MESSAGES.BILL_PROCESSING);

    const mediaId = message.image.id;
    let parsedBill;

    try {
      const { buffer, mimeType } = await downloadMedia(mediaId);
      const base64 = buffer.toString('base64');
      parsedBill = await parseBillImage(base64, mimeType);
    } catch (err) {
      console.error('Bill parsing failed:', err.message);
      await db.logError(store.id, 'BILL_PARSE_ERROR', { mediaId }, err.message);
      await sendText(fromNumber, MESSAGES.BILL_UNREADABLE);
      return;
    }

    if (!parsedBill?.items?.length) {
      await sendText(fromNumber, MESSAGES.BILL_UNREADABLE);
      return;
    }

    // Save bill photo record
    const billPhoto = await db.createBillPhoto({
      store_id: store.id,
      photo_url: mediaId, // store media ID as reference
      ai_parsed_data: parsedBill,
      confirmed: false,
    });

    // Set state to AWAITING_BILL_CONFIRM
    await db.updateConversationState(store.id, 'AWAITING_BILL_CONFIRM', {
      bill_photo_id: billPhoto.id,
      parsed_items: parsedBill.items,
      supplier_name: parsedBill.supplier_name,
      bill_total: parsedBill.bill_total,
    });

    // Send confirmation to owner
    await sendText(
      fromNumber,
      MESSAGES.BILL_CONFIRM(parsedBill.items, parsedBill.bill_total, parsedBill.supplier_name)
    );
    return;
  }

  // Step 2: Owner responding to bill confirmation
  if (store.conversation_state === 'AWAITING_BILL_CONFIRM') {
    const text = (message.text?.body || '').trim().toLowerCase();
    const stateData = store.state_data || {};
    const parsedItems = stateData.parsed_items || [];

    // Owner confirmed
    if (['haan', 'han', 'yes', 'ok', 'sahi', 'correct', 'theek', 'ha', '👍'].some((w) => text.includes(w))) {
      await processBillItems(store, parsedItems, stateData.bill_photo_id, fromNumber);
      return;
    }

    // Owner is correcting — try to parse the correction
    // Format: "cement 40 bags tha" or "cement 40"
    const correctionMatch = text.match(/^(.+?)\s+(\d+(?:\.\d+)?)/);
    if (correctionMatch) {
      const correctedName = correctionMatch[1].trim();
      const correctedQty = parseFloat(correctionMatch[2]);

      // Find and update the item
      const updatedItems = parsedItems.map((item) => {
        if (item.product_name.toLowerCase().includes(correctedName.toLowerCase())) {
          return { ...item, quantity: correctedQty };
        }
        return item;
      });

      await db.updateConversationState(store.id, 'AWAITING_BILL_CONFIRM', {
        ...stateData,
        parsed_items: updatedItems,
      });

      await sendText(
        fromNumber,
        MESSAGES.BILL_CORRECTION_ACK(`${correctedName} ${correctedQty}`)
      );
      // Re-show updated confirmation
      await sendText(
        fromNumber,
        MESSAGES.BILL_CONFIRM(updatedItems, stateData.bill_total, stateData.supplier_name)
      );
      return;
    }

    // Unknown response
    await sendText(fromNumber, 'Haan ya Nahi batao, ya correction batao (example: cement 40 bags tha)');
  }
}

/**
 * Process confirmed bill items — create stock movements and update inventory.
 */
async function processBillItems(store, items, billPhotoId, fromNumber) {
  const storeProducts = await db.getProducts(store.id);
  const updates = [];

  for (const item of items) {
    if (!item.quantity || item.quantity <= 0) continue;

    // Find matching product in store
    let product = storeProducts.find(
      (p) => p.name.toLowerCase().includes(item.product_name.toLowerCase())
    );

    // Auto-create product if not found
    if (!product) {
      product = await db.createProduct({
        store_id: store.id,
        name: item.product_name,
        unit: item.unit || 'pieces',
        current_stock: 0,
        low_stock_threshold: 0,
      });
    }

    const newStock = Number(product.current_stock) + Number(item.quantity);
    await db.updateProductStock(product.id, newStock);

    await db.createStockMovement({
      store_id: store.id,
      product_id: product.id,
      movement_type: 'IN',
      quantity: item.quantity,
      source: 'photo',
      bill_photo_id: billPhotoId,
    });

    updates.push({ name: item.product_name, quantity: item.quantity });
  }

  // Mark photo as confirmed
  if (billPhotoId) await db.confirmBillPhoto(billPhotoId);

  // Reset state
  await db.updateConversationState(store.id, 'IDLE', {});

  await sendText(fromNumber, MESSAGES.BILL_CONFIRMED(updates));
}

module.exports = { handleBillPhoto };

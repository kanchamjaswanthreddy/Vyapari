const db = require('../db/supabase');
const { sendText, sendButtons } = require('../whatsapp/send');
const MESSAGES = require('../messages');

/**
 * Generate supplier reorder message based on language preference.
 */
function buildReorderMessage(store, supplier, product, quantity) {
  const lang = store.language_pref || 'hindi';
  const unit = product.unit;

  if (lang === 'english') {
    return `Hello ${supplier.name},

This is an order from ${store.shop_name}, ${store.city || ''}.

Order Details:
${product.name} — ${quantity} ${unit}

Please confirm delivery date.
Thank you
${store.owner_name}
Sent via Vyapari`;
  }

  // Default: Hindi
  return `Namaste ${supplier.name} bhai,

Yeh order hai ${store.shop_name}, ${store.city || ''} se.

Order:
${product.name} — ${quantity} ${unit}

Delivery kab hogi? Please confirm karein.
Shukriya
${store.owner_name}
Vyapari se bheja gaya`;
}

/**
 * Trigger low stock alert for a product — called by the cron job.
 */
async function sendLowStockAlert(store, product) {
  const fromNumber = store.whatsapp_number;
  const supplierName = product.suppliers?.name || null;

  const alertText = MESSAGES.LOW_STOCK_ALERT(
    product.name,
    product.current_stock,
    product.low_stock_threshold,
    product.unit,
    supplierName
  );

  await sendButtons(fromNumber, alertText, [
    { id: `reorder_${product.id}`, title: 'Reorder Now' },
    { id: `snooze_${product.id}`, title: 'Snooze 1 Day' },
    { id: `threshold_${product.id}`, title: 'Update Threshold' },
  ]);

  // Track alert sent time to avoid spam
  await db.supabase
    .from('products')
    .update({ last_alert_sent_at: new Date().toISOString() })
    .eq('id', product.id);
}

/**
 * Handle reorder button press: "Reorder Now" tapped.
 */
async function handleReorderStart(store, productId, fromNumber) {
  const products = await db.getProducts(store.id);
  const product = products.find((p) => p.id === productId);

  if (!product) {
    await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    return;
  }

  await db.updateConversationState(store.id, 'AWAITING_REORDER_QTY', {
    product_id: productId,
    product_name: product.name,
    product_unit: product.unit,
    supplier_id: product.primary_supplier_id,
    last_qty: product.last_reorder_qty,
  });

  await sendText(
    fromNumber,
    MESSAGES.REORDER_ASK_QTY(product.name, product.last_reorder_qty, product.unit)
  );
}

/**
 * Handle quantity input for reorder.
 */
async function handleReorderQty(store, message, fromNumber) {
  const text = message.text?.body?.trim() || '';
  const qty = parseFloat(text);
  const stateData = store.state_data || {};

  if (isNaN(qty) || qty <= 0) {
    await sendText(fromNumber, 'Valid quantity batao. Example: 50');
    return;
  }

  // Find supplier
  let supplierName = 'Supplier';
  if (stateData.supplier_id) {
    const { data: supplier } = await db.supabase
      .from('suppliers')
      .select('name')
      .eq('id', stateData.supplier_id)
      .single();
    if (supplier) supplierName = supplier.name;
  }

  await db.updateConversationState(store.id, 'AWAITING_SUPPLIER_CONFIRM', {
    ...stateData,
    quantity: qty,
    supplier_name: supplierName,
  });

  await sendText(
    fromNumber,
    MESSAGES.REORDER_CONFIRM_SEND(supplierName, stateData.product_name, qty, stateData.product_unit)
  );
}

/**
 * Handle final supplier send confirmation.
 */
async function handleSupplierConfirm(store, message, fromNumber) {
  const text = message.text?.body?.trim().toLowerCase() || '';
  const stateData = store.state_data || {};

  if (!['haan', 'han', 'yes', 'ok', 'ha'].some((w) => text.includes(w))) {
    await db.updateConversationState(store.id, 'IDLE', {});
    await sendText(fromNumber, 'Theek hai, order cancel kar diya.');
    return;
  }

  // Get full product and supplier details
  const products = await db.getProducts(store.id);
  const product = products.find((p) => p.id === stateData.product_id);

  const { data: supplier } = await db.supabase
    .from('suppliers')
    .select('*')
    .eq('id', stateData.supplier_id)
    .single();

  if (!product || !supplier) {
    await sendText(fromNumber, MESSAGES.TECHNICAL_ERROR);
    await db.updateConversationState(store.id, 'IDLE', {});
    return;
  }

  const messageText = buildReorderMessage(store, supplier, product, stateData.quantity);

  // Send to supplier's WhatsApp
  const { sendText: sendWhatsApp } = require('../whatsapp/send');
  try {
    await sendWhatsApp(supplier.whatsapp_number, messageText);
  } catch (err) {
    console.error('Supplier message failed:', err.message);
    await sendText(fromNumber, MESSAGES.REORDER_SUPPLIER_FAILED(supplier.whatsapp_number));
    await db.updateConversationState(store.id, 'IDLE', {});
    return;
  }

  // Log reorder
  await db.createReorder({
    store_id: store.id,
    product_id: stateData.product_id,
    supplier_id: stateData.supplier_id,
    quantity_ordered: stateData.quantity,
    message_sent: messageText,
    status: 'pending',
  });

  // Update last reorder qty
  await db.supabase
    .from('products')
    .update({ last_reorder_qty: stateData.quantity })
    .eq('id', stateData.product_id);

  await db.updateConversationState(store.id, 'IDLE', {});
  await sendText(fromNumber, MESSAGES.REORDER_SENT(supplier.name));
}

/**
 * Handle snooze button — defer alert by 24 hours.
 */
async function handleSnooze(store, productId, fromNumber) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.supabase
    .from('products')
    .update({ last_alert_sent_at: tomorrow })
    .eq('id', productId);

  await sendText(fromNumber, 'Theek hai — kal bataunga. 🕐');
}

module.exports = {
  sendLowStockAlert,
  handleReorderStart,
  handleReorderQty,
  handleSupplierConfirm,
  handleSnooze,
};

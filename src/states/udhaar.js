const db = require('../db/supabase');
const { sendText } = require('../whatsapp/send');
const MESSAGES = require('../messages');

/**
 * Parse udhaar credit: "ravi ne 500 udhar liya" → {name, amount}
 */
function parseCreditMessage(text) {
  // Pattern: "[name] ne [amount] udhar liya"
  const pattern = /^(.+?)\s+ne\s+(\d+(?:\.\d+)?)\s+(?:udhar|udhaar|credit)/i;
  const match = text.match(pattern);
  if (!match) return null;
  return { name: match[1].trim(), amount: parseFloat(match[2]) };
}

/**
 * Parse udhaar payment: "ravi ne 300 diya"
 */
function parsePaymentMessage(text) {
  // Pattern: "[name] ne [amount] diya" or "[name] paid [amount]"
  const pattern1 = /^(.+?)\s+ne\s+(\d+(?:\.\d+)?)\s+(?:diya|paid|wapas)/i;
  const pattern2 = /^(.+?)\s+(?:paid|payment)\s+(\d+(?:\.\d+)?)/i;
  const match = text.match(pattern1) || text.match(pattern2);
  if (!match) return null;
  return { name: match[1].trim(), amount: parseFloat(match[2]) };
}

/**
 * Parse balance check: "ravi ka kitna baaki" → name
 */
function parseBalanceCheck(text) {
  // Pattern: "[name] ka kitna baaki" or "kitna baaki [name]"
  const pattern1 = /^(.+?)\s+ka\s+(?:kitna\s+)?(?:baaki|balance|hisaab)/i;
  const pattern2 = /(?:kitna\s+baaki|balance)\s+(.+)/i;
  const match = text.match(pattern1) || text.match(pattern2);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Handle all udhaar-related intents.
 */
async function handleUdhaarCredit(store, message, fromNumber) {
  const text = message.text?.body?.trim() || '';
  const parsed = parseCreditMessage(text);

  if (!parsed) {
    await sendText(fromNumber, 'Format: "[naam] ne [amount] udhar liya"\nExample: Ravi ne 500 udhar liya');
    return;
  }

  await db.createUdhaarEntry({
    store_id: store.id,
    customer_name: parsed.name,
    amount: parsed.amount,
    type: 'credit',
  });

  const balance = await db.getCustomerBalance(store.id, parsed.name);
  await sendText(fromNumber, MESSAGES.UDHAAR_RECORDED(parsed.name, parsed.amount, balance));
}

async function handleUdhaarPayment(store, message, fromNumber) {
  const text = message.text?.body?.trim() || '';
  const parsed = parsePaymentMessage(text);

  if (!parsed) {
    await sendText(fromNumber, 'Format: "[naam] ne [amount] diya"\nExample: Ravi ne 300 diya');
    return;
  }

  await db.createUdhaarEntry({
    store_id: store.id,
    customer_name: parsed.name,
    amount: parsed.amount,
    type: 'payment',
  });

  const balance = await db.getCustomerBalance(store.id, parsed.name);
  await sendText(fromNumber, MESSAGES.UDHAAR_PAYMENT(parsed.name, parsed.amount, balance));
}

async function handleCheckBalance(store, message, fromNumber) {
  const text = message.text?.body?.trim() || '';
  const name = parseBalanceCheck(text);

  if (!name) {
    await sendText(fromNumber, 'Format: "[naam] ka kitna baaki"\nExample: Ravi ka kitna baaki');
    return;
  }

  const balance = await db.getCustomerBalance(store.id, name);
  await sendText(fromNumber, MESSAGES.UDHAAR_BALANCE(name, balance));
}

async function handleUdhaarList(store, fromNumber) {
  const entries = await db.getAllUdhaarBalances(store.id);
  await sendText(fromNumber, MESSAGES.UDHAAR_LIST(entries));
}

module.exports = { handleUdhaarCredit, handleUdhaarPayment, handleCheckBalance, handleUdhaarList };

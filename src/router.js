/**
 * Intent Router — classifies IDLE state messages into intents.
 * All keyword patterns are in Hindi/Telugu/English.
 */

const INTENTS = {
  BILL_PHOTO: 'BILL_PHOTO',
  STOCK_OUT: 'STOCK_OUT',
  UDHAAR_CREDIT: 'UDHAAR_CREDIT',
  UDHAAR_PAYMENT: 'UDHAAR_PAYMENT',
  CHECK_BALANCE: 'CHECK_BALANCE',
  UDHAAR_LIST: 'UDHAAR_LIST',
  CHECK_STOCK: 'CHECK_STOCK',
  SUMMARY: 'SUMMARY',
  HELP: 'HELP',
  UNDO: 'UNDO',
  ADD_PRODUCT: 'ADD_PRODUCT',
  ADD_SUPPLIER: 'ADD_SUPPLIER',
  UNKNOWN: 'UNKNOWN',
};

function detectIntent(message) {
  // Image message
  if (message.type === 'image') return INTENTS.BILL_PHOTO;

  // Audio/voice message
  if (message.type === 'audio') return 'VOICE_OUT';

  // Interactive button reply
  if (message.type === 'interactive') {
    const buttonId = message.interactive?.button_reply?.id || '';
    if (buttonId.startsWith('reorder_')) return 'BUTTON_REORDER';
    if (buttonId.startsWith('snooze_')) return 'BUTTON_SNOOZE';
    if (buttonId.startsWith('threshold_')) return 'BUTTON_THRESHOLD';
    return INTENTS.UNKNOWN;
  }

  const raw = message.text?.body || '';
  const text = raw.toLowerCase().trim();

  // STOCK OUT — must check before UDHAAR to avoid false positives
  if (
    /^(sold|becha|nikala|sell)\b/i.test(text) ||
    /^\d+(?:\.\d+)?\s+\w/.test(text) // starts with number then product
  ) {
    return INTENTS.STOCK_OUT;
  }

  // UDHAAR CREDIT
  if (/udhar|udhaar|credit/.test(text) && /ne\s+\d/.test(text)) {
    return INTENTS.UDHAAR_CREDIT;
  }

  // UDHAAR PAYMENT
  if (
    /ne\s+\d.*(diya|paid|wapas)/.test(text) ||
    /(diya|paid|payment)\s+\d/.test(text)
  ) {
    return INTENTS.UDHAAR_PAYMENT;
  }

  // ALL UDHAAR LIST
  if (/sab\s*ka\s*hisaab|sab\s*ka\s*baaki|all\s*balance/.test(text)) {
    return INTENTS.UDHAAR_LIST;
  }

  // CHECK BALANCE
  if (/kitna\s+baaki|ka\s+baaki|balance|hisaab/.test(text) && !/summary|aaj|today/.test(text)) {
    return INTENTS.CHECK_BALANCE;
  }

  // SUMMARY
  if (/summary|aaj\s*ka|hisaab|report|today\s*stats/.test(text)) {
    return INTENTS.SUMMARY;
  }

  // UNDO
  if (/undo|galat|mistake|wapas\s*karo|cancel\s*last/.test(text)) {
    return INTENTS.UNDO;
  }

  // CHECK STOCK
  if (/kitna\s+hai|stock|inventory|kitna\s+bacha/.test(text)) {
    return INTENTS.CHECK_STOCK;
  }

  // HELP
  if (/help|kya\s+kar|commands|menu|kya\s+hota/.test(text)) {
    return INTENTS.HELP;
  }

  // ADD PRODUCT
  if (/naya\s+product|add\s+product|new\s+product|item\s+add/.test(text)) {
    return INTENTS.ADD_PRODUCT;
  }

  // ADD SUPPLIER
  if (/naya\s+supplier|add\s+supplier|new\s+supplier/.test(text)) {
    return INTENTS.ADD_SUPPLIER;
  }

  return INTENTS.UNKNOWN;
}

module.exports = { detectIntent, INTENTS };

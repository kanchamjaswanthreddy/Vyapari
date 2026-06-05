const db = require('../db/supabase');
const { sendText } = require('../whatsapp/send');
const MESSAGES = require('../messages');

/**
 * Detect language from text.
 * Simple heuristic: check for Telugu Unicode range.
 */
function detectLanguage(text) {
  if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
  if (/[^\u0000-\u007F]/.test(text)) return 'hindi'; // non-ASCII, assume Devanagari
  return 'english';
}

/**
 * Parse supplier input: "Ramesh Traders, 9876543210"
 */
function parseSupplierInput(text) {
  const parts = text.split(',').map((s) => s.trim());
  if (parts.length < 2) return null;
  const phone = parts[parts.length - 1].replace(/\D/g, '');
  const name = parts.slice(0, parts.length - 1).join(',').trim();
  if (!phone || phone.length < 10) return null;
  return { name, phone };
}

/**
 * Parse product list: "cement bags, steel rods, PVC pipe metres"
 * Returns [{name, unit}]
 */
function parseProductList(text) {
  // Split by comma
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  return items.map((item) => {
    // Try to extract unit from the last word(s)
    const UNITS = ['bags', 'bag', 'kg', 'pieces', 'piece', 'pcs', 'metres', 'meter', 'litres', 'litre', 'ltr', 'units', 'unit', 'nos', 'box', 'boxes', 'rolls', 'roll', 'sheets', 'sheet'];
    const words = item.toLowerCase().split(' ');
    let unit = 'pieces';
    let nameParts = words;

    for (let i = words.length - 1; i >= 0; i--) {
      if (UNITS.includes(words[i])) {
        unit = words[i];
        nameParts = words.slice(0, i);
        break;
      }
    }

    const name = nameParts.join(' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { name: name || item, unit };
  });
}

/**
 * Parse threshold input: "cement 10, steel 20, pipe 15"
 * Returns [{name, value}]
 */
function parseThresholds(text) {
  const parts = text.split(',').map((s) => s.trim());
  return parts.map((part) => {
    const match = part.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    return { name: match[1].trim(), value: parseFloat(match[2]) };
  }).filter(Boolean);
}

/**
 * Handle all onboarding states.
 */
async function handleOnboarding(store, message, fromNumber) {
  const state = store ? store.conversation_state : 'NEW';
  const text = message.text?.body?.trim() || '';

  // NEW store — first message ever
  if (!store) {
    // Create a temporary store record with state ONBOARDING_NAME
    const newStore = await db.createStore({
      whatsapp_number: fromNumber,
      owner_name: '',
      shop_name: '',
      conversation_state: 'ONBOARDING_NAME',
      language_pref: detectLanguage(text),
    });
    await sendText(fromNumber, MESSAGES.WELCOME);
    return;
  }

  if (state === 'ONBOARDING_NAME') {
    if (!text) return sendText(fromNumber, 'Apna naam batao.');
    await db.updateStore(store.id, {
      owner_name: text,
      conversation_state: 'ONBOARDING_SHOP',
      language_pref: detectLanguage(text),
    });
    await sendText(fromNumber, MESSAGES.ASK_SHOP_NAME(text));
    return;
  }

  if (state === 'ONBOARDING_SHOP') {
    if (!text) return sendText(fromNumber, 'Dukan ka naam batao.');
    await db.updateStore(store.id, {
      shop_name: text,
      conversation_state: 'ONBOARDING_CITY',
    });
    await sendText(fromNumber, MESSAGES.ASK_CITY(text));
    return;
  }

  if (state === 'ONBOARDING_CITY') {
    if (!text) return sendText(fromNumber, 'Sheher ka naam batao.');
    await db.updateStore(store.id, {
      city: text,
      conversation_state: 'ONBOARDING_SUPPLIER',
    });
    await sendText(fromNumber, MESSAGES.ASK_FIRST_SUPPLIER);
    return;
  }

  if (state === 'ONBOARDING_SUPPLIER') {
    const parsed = parseSupplierInput(text);
    if (!parsed) {
      return sendText(
        fromNumber,
        'Format sahi nahi laga. Example: Ramesh Traders, 9876543210'
      );
    }
    const supplier = await db.createSupplier({
      store_id: store.id,
      name: parsed.name,
      whatsapp_number: parsed.phone,
    });
    await db.updateStore(store.id, {
      conversation_state: 'ONBOARDING_PRODUCTS',
      state_data: { first_supplier_id: supplier.id, first_supplier_name: parsed.name },
    });
    await sendText(fromNumber, MESSAGES.ASK_PRODUCTS(parsed.name));
    return;
  }

  if (state === 'ONBOARDING_PRODUCTS') {
    const products = parseProductList(text);
    if (!products.length) {
      return sendText(fromNumber, 'Products samajh nahi aaye. Example: cement bags, steel rods, PVC pipe');
    }

    // Save all products
    for (const p of products) {
      await db.createProduct({
        store_id: store.id,
        name: p.name,
        unit: p.unit,
        current_stock: 0,
        low_stock_threshold: 0,
      });
    }

    await db.updateStore(store.id, {
      conversation_state: 'ONBOARDING_THRESHOLDS',
      state_data: { ...(store.state_data || {}), products },
    });
    await sendText(fromNumber, MESSAGES.CONFIRM_PRODUCTS(products));
    await sendText(fromNumber, MESSAGES.ASK_THRESHOLDS);
    return;
  }

  if (state === 'ONBOARDING_THRESHOLDS') {
    let thresholds = null;

    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'nahi') {
      const parsed = parseThresholds(text);

      if (parsed.length) {
        // Match threshold names to products and update
        const storeProducts = await db.getProducts(store.id);
        thresholds = [];

        for (const t of parsed) {
          const match = storeProducts.find((p) =>
            p.name.toLowerCase().includes(t.name.toLowerCase())
          );
          if (match) {
            await db.supabase
              .from('products')
              .update({ low_stock_threshold: t.value })
              .eq('id', match.id);
            thresholds.push({ name: match.name, value: t.value, unit: match.unit });
          }
        }
      }
    }

    await db.updateStore(store.id, {
      conversation_state: 'IDLE',
      state_data: {},
    });
    await sendText(fromNumber, MESSAGES.ONBOARDING_COMPLETE(thresholds));
    return;
  }
}

module.exports = { handleOnboarding };

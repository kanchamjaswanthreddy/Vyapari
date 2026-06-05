/**
 * All WhatsApp message text constants for Vyapari.
 * Edit text here — never hardcode strings in flow files.
 */

const MESSAGES = {
  // Onboarding
  WELCOME: `Namaste! Main Vyapari hun — aapka dukan ka digital munim. 🏪\n\nMain aapki inventory track karta hun, supplier ko auto-order bhejta hun, aur aapko daily hisaab deta hun — sab kuch WhatsApp pe, koi app download nahi.\n\nShuru karte hain? Apna naam batao.`,
  ASK_SHOP_NAME: (name) => `Namaste ${name} bhai! Aapki dukan ka naam kya hai?`,
  ASK_CITY: (shopName) => `${shopName} — perfect! Aap kaunse sheher mein hain?`,
  ASK_FIRST_SUPPLIER: `Ab aapka pehla supplier add karte hain.\n\nAapka ek supplier ka naam aur WhatsApp number batao. (Baad mein aur add kar sakte hain)\n\nExample: Ramesh Traders, 9876543210`,
  ASK_PRODUCTS: (supplierName) => `${supplierName} saved! Ab aapke 3 main products batao jinki inventory track karni hai.\n\nFormat: naam aur unit\nExample: cement bags, steel rods, PVC pipe metres`,
  CONFIRM_PRODUCTS: (products) => {
    const list = products.map((p, i) => `${i + 1}. ${p.name} (${p.unit})`).join('\n');
    return `${products.length} products add ho gaye:\n${list}\n\nSahi hai?`;
  },
  ASK_THRESHOLDS: `Last step! Kab alert bhejun jab stock kam ho?\n\nExample: cement 10, steel 20, pipe 15\n\n(Skip karna hai? 'skip' type karo)`,
  ONBOARDING_COMPLETE: (thresholds) => {
    const thresholdText = thresholds
      ? thresholds.map((t) => `– ${t.name}: alert at ${t.value} ${t.unit}`).join('\n')
      : '– Koi threshold set nahi hua (baad mein set kar sakte hain)';
    return `Perfect! Alerts set:\n${thresholdText}\n\n✅ Vyapari ready hai! Jab bhi stock aaye, bill ki photo bhejo. Bich hisaab ke liye 'help' type karo. 🎉`;
  },

  // Bill Photo
  BILL_PROCESSING: `Bill mil gayi! Padh raha hun... ek second. 🔍`,
  BILL_CONFIRM: (items, total, supplier) => {
    const list = items
      .map((item, i) => {
        const price = item.unit_price ? ` @ ₹${item.unit_price} = ₹${item.total_price || '?'}` : '';
        return `${i + 1}. ${item.product_name} — ${item.quantity} ${item.unit}${price}`;
      })
      .join('\n');
    const totalText = total ? `\nTotal: ₹${total}` : '';
    const supplierText = supplier ? ` | Supplier: ${supplier}` : '';
    return `Bill mili! Maine yeh items dekhe:\n\n${list}${totalText}${supplierText}\n\nSahi hai? (Haan / Nahi — correction batao)`;
  },
  BILL_CORRECTION_ACK: (correction) => `Samajh gaya — ${correction} updated. Baaki sahi hai?`,
  BILL_CONFIRMED: (updates) => {
    const list = updates.map((u) => `+${u.quantity} ${u.name}`).join('\n');
    return `Done! Inventory updated:\n${list}`;
  },
  BILL_UNREADABLE: `Maafi karo — yeh photo clearly nahi padh paaya. Kya aap ek aur photo bhej sakte hain with better light?\n\nYa manually batao: product naam aur quantity, main update kar deta hun.`,

  // Stock OUT
  STOCK_OUT_CONFIRM: (product, qty, unit, remaining, customer) => {
    const custText = customer ? ` (${customer})` : '';
    return `${qty} ${product} OUT${custText}. Stock remaining: ${remaining} ${unit}.`;
  },
  AMBIGUOUS_PRODUCT: (matches) => {
    const list = matches.map((m, i) => `${i + 1}. ${m.name} (${m.unit})`).join('\n');
    return `Kaunsa product?\n${list}\n\nNumber bhejo (1, 2, ya ${matches.length})`;
  },
  UNDO_CONFIRM: (entry) => `Last entry: ${entry.quantity} ${entry.product_name} ${entry.movement_type} (${entry.time_ago}). Undo karoon?`,
  UNDO_DONE: (product, qty, unit, stock) => `Done! ${qty} ${product} wapas add ho gaye. Stock: ${stock} ${unit}.`,
  UNDO_NOTHING: `Koi recent entry nahi mili undo ke liye.`,

  // Low Stock Alert
  LOW_STOCK_ALERT: (product, current, threshold, unit, supplier) => {
    const supplierText = supplier ? `\nSupplier: ${supplier}` : '';
    return `⚠️ Low Stock Alert!\n\n${product}: ${current} ${unit} remaining (threshold: ${threshold} ${unit})${supplierText}\n\nKya karein?`;
  },

  // Reorder
  REORDER_ASK_QTY: (product, lastQty, unit) => {
    const suggestion = lastQty ? ` (last time: ${lastQty} ${unit})` : '';
    return `${product} ke liye kitni quantity order karein?${suggestion}`;
  },
  REORDER_CONFIRM_SEND: (supplier, product, qty, unit) =>
    `${qty} ${unit} ${product} ka order ${supplier} ko bhejna hai? (Haan / Nahi)`,
  REORDER_SENT: (supplier) => `Order bhej diya ${supplier} ko! ✅`,
  REORDER_SUPPLIER_FAILED: (phone) =>
    `Supplier ko message nahi pahuncha — shayad unka number WhatsApp pe nahi hai.\nAap directly call kar sakte hain: ${phone}\n\nSupplier ka number update karna hai? 'supplier update [naam] [number]' type karo.`,

  // Udhaar
  UDHAAR_RECORDED: (name, amount, balance) =>
    `${name} ka ₹${amount} udhar recorded. Kul baaki: ₹${balance}`,
  UDHAAR_PAYMENT: (name, amount, balance) =>
    `${name} ka ₹${amount} payment recorded. Kul baaki: ₹${balance}`,
  UDHAAR_BALANCE: (name, balance) =>
    balance > 0 ? `${name} bhai ka baaki: ₹${balance}` : `${name} ka koi baaki nahi. ✅`,
  UDHAAR_LIST: (entries) => {
    if (!entries.length) return `Kisi ka koi baaki nahi. 🎉`;
    const list = entries.map((e) => `– ${e.customer_name}: ₹${e.balance}`).join('\n');
    return `Sab ka hisaab:\n\n${list}`;
  },

  // Daily Summary
  DAILY_SUMMARY: ({ date, soldItems, lowStock, udhaarList, pendingReorders }) => {
    const soldText = soldItems.length
      ? soldItems.map((i) => `– ${i.name}: ${i.qty} ${i.unit}`).join('\n')
      : '– Koi sale record nahi hua aaj';
    const lowText = lowStock.length
      ? lowStock.map((i) => `– ${i.name}: ${i.current} ${i.unit} (threshold: ${i.threshold})`).join('\n')
      : '– Sab stock theek hai';
    const udhaarText = udhaarList.length
      ? udhaarList.slice(0, 3).map((u) => `– ${u.customer_name}: ₹${u.balance}`).join('\n')
      : '– Koi pending udhaar nahi';
    const reorderText = pendingReorders.length
      ? pendingReorders.map((r) => `– ${r.product_name} (order pending)`).join('\n')
      : '– Koi pending reorder nahi';

    return `📊 Aaj ka Hisaab — ${date}\n\n📦 Aaj beche:\n${soldText}\n\n⚠️ Kam stock:\n${lowText}\n\n💰 Top Udhaar:\n${udhaarText}\n\n🔄 Pending Reorders:\n${reorderText}`;
  },

  // Help Menu
  HELP: `Main yeh sab kar sakta hun:\n\n📦 STOCK IN: Bill ki photo bhejo\n📤 STOCK OUT: 'sold [qty] [product]'\n⚠️ ALERTS: Automatic jab stock kam ho\n💰 UDHAAR: '[naam] ne [amount] udhar liya'\n📊 SUMMARY: 'aaj ka hisaab'\n↩️ UNDO: 'undo' — last entry wapas lo\n\nAur kuch chahiye? Type karo!`,

  // Errors
  UNKNOWN_COMMAND: `Yeh samajh nahi aaya. Help ke liye 'help' type karo.`,
  TECHNICAL_ERROR: `Thoda technical issue hua — 2 minute mein dobara try karo.`,
  UNKNOWN_PRODUCT: (name) => `'${name}' product nahi mila. 'help' type karo ya product ka pura naam batao.`,
};

module.exports = MESSAGES;

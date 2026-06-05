const cron = require('node-cron');
const { supabase } = require('../db/supabase');
const { sendLowStockAlert } = require('../states/reorder');

/**
 * Run every 6 hours — check all stores for low stock.
 * Skip if alert was sent within the last 24 hours for that product.
 */
function startLowStockJob() {
  // Run at 0, 6, 12, 18 hours every day (IST = UTC+5:30)
  cron.schedule('0 0,6,12,18 * * *', async () => {
    console.log('[LowStockCheck] Running low stock check...');
    try {
      await runLowStockCheck();
    } catch (err) {
      console.error('[LowStockCheck] Error:', err.message);
    }
  });

  console.log('[LowStockCheck] Cron job scheduled (every 6 hours)');
}

async function runLowStockCheck() {
  const now = new Date();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Get all active stores
  const { data: stores, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('is_active', true);

  if (storeError) {
    console.error('[LowStockCheck] Failed to fetch stores:', storeError.message);
    return;
  }

  for (const store of stores || []) {
    try {
      // Get products below threshold with stale or no alert
      const { data: lowProducts, error } = await supabase
        .from('products')
        .select('*, suppliers(*)')
        .eq('store_id', store.id)
        .gt('low_stock_threshold', 0)
        .or(`last_alert_sent_at.is.null,last_alert_sent_at.lt.${oneDayAgo}`);

      if (error) {
        console.error(`[LowStockCheck] Store ${store.id} error:`, error.message);
        continue;
      }

      for (const product of lowProducts || []) {
        if (Number(product.current_stock) <= Number(product.low_stock_threshold)) {
          await sendLowStockAlert(store, product);
          console.log(`[LowStockCheck] Alert sent: ${store.shop_name} — ${product.name}`);
        }
      }
    } catch (err) {
      console.error(`[LowStockCheck] Store ${store.id} failed:`, err.message);
    }
  }
}

module.exports = { startLowStockJob, runLowStockCheck };

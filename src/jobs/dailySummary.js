const cron = require('node-cron');
const { supabase } = require('../db/supabase');
const { sendText } = require('../whatsapp/send');
const { getTodaySales, getAllUdhaarBalances, getPendingReorders, getLowStockProducts } = require('../db/supabase');
const MESSAGES = require('../messages');

/**
 * Run daily at 8 PM IST (14:30 UTC).
 */
function startDailySummaryJob() {
  cron.schedule('30 14 * * *', async () => {
    console.log('[DailySummary] Running 8 PM summary...');
    try {
      await sendAllSummaries();
    } catch (err) {
      console.error('[DailySummary] Error:', err.message);
    }
  });

  console.log('[DailySummary] Cron job scheduled (8 PM IST daily)');
}

async function sendAllSummaries() {
  const { data: stores, error } = await supabase
    .from('stores')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('[DailySummary] Failed to fetch stores:', error.message);
    return;
  }

  for (const store of stores || []) {
    try {
      await sendStoreSummary(store);
    } catch (err) {
      console.error(`[DailySummary] Store ${store.id} failed:`, err.message);
    }
  }
}

/**
 * Build and send daily summary for a single store.
 * Can also be called on-demand.
 */
async function sendStoreSummary(store) {
  const today = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Aggregate today's sales
  const todaySales = await getTodaySales(store.id);
  const salesMap = {};
  for (const sale of todaySales) {
    const key = sale.products?.name || 'Unknown';
    if (!salesMap[key]) {
      salesMap[key] = { name: key, qty: 0, unit: sale.products?.unit || '' };
    }
    salesMap[key].qty += Number(sale.quantity);
  }
  const soldItems = Object.values(salesMap);

  // Low stock products
  const lowStockProducts = await getLowStockProducts(store.id);
  const lowStock = lowStockProducts.map((p) => ({
    name: p.name,
    current: p.current_stock,
    threshold: p.low_stock_threshold,
    unit: p.unit,
  }));

  // Top udhaar
  const udhaarList = await getAllUdhaarBalances(store.id);

  // Pending reorders
  const reorders = await getPendingReorders(store.id);
  const pendingReorders = reorders.map((r) => ({
    product_name: r.products?.name || 'Unknown',
  }));

  const summary = MESSAGES.DAILY_SUMMARY({
    date: today,
    soldItems,
    lowStock,
    udhaarList,
    pendingReorders,
  });

  await sendText(store.whatsapp_number, summary);
}

module.exports = { startDailySummaryJob, sendStoreSummary };

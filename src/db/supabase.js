const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// --- Stores ---
async function getStoreByPhone(whatsappNumber) {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || null;
}

async function createStore(data) {
  const { data: store, error } = await supabase
    .from('stores')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return store;
}

async function updateStore(storeId, updates) {
  const { error } = await supabase
    .from('stores')
    .update(updates)
    .eq('id', storeId);
  if (error) throw error;
}

async function updateConversationState(storeId, state, stateData = {}) {
  await updateStore(storeId, {
    conversation_state: state,
    state_data: stateData,
  });
}

// --- Products ---
async function getProducts(storeId) {
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(*)')
    .eq('store_id', storeId);
  if (error) throw error;
  return data || [];
}

async function getProductByName(storeId, name) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('store_id', storeId)
    .ilike('name', `%${name}%`);
  if (error) throw error;
  return data || [];
}

async function createProduct(data) {
  const { data: product, error } = await supabase
    .from('products')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return product;
}

async function updateProductStock(productId, newStock) {
  const { error } = await supabase
    .from('products')
    .update({ current_stock: newStock })
    .eq('id', productId);
  if (error) throw error;
}

async function getLowStockProducts(storeId) {
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(*)')
    .eq('store_id', storeId)
    .gt('low_stock_threshold', 0)
    .filter('current_stock', 'lte', 'low_stock_threshold');
  if (error) throw error;
  return data || [];
}

// --- Suppliers ---
async function createSupplier(data) {
  const { data: supplier, error } = await supabase
    .from('suppliers')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return supplier;
}

async function getSupplierByName(storeId, name) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('store_id', storeId)
    .ilike('name', `%${name}%`)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// --- Stock Movements ---
async function createStockMovement(data) {
  const { data: movement, error } = await supabase
    .from('stock_movements')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return movement;
}

async function getLastMovement(storeId) {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, products(name, unit)')
    .eq('store_id', storeId)
    .eq('is_undone', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function undoMovement(movementId, productId, reverseDelta) {
  // Mark as undone
  const { error: undoError } = await supabase
    .from('stock_movements')
    .update({ is_undone: true })
    .eq('id', movementId);
  if (undoError) throw undoError;

  // Get current stock to reverse
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('current_stock')
    .eq('id', productId)
    .single();
  if (productError) throw productError;

  await updateProductStock(productId, product.current_stock + reverseDelta);
  return product.current_stock + reverseDelta;
}

async function getTodaySales(storeId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, products(name, unit)')
    .eq('store_id', storeId)
    .eq('movement_type', 'OUT')
    .eq('is_undone', false)
    .gte('created_at', startOfDay.toISOString());
  if (error) throw error;
  return data || [];
}

// --- Udhaar Ledger ---
async function createUdhaarEntry(data) {
  const { data: entry, error } = await supabase
    .from('udhaar_ledger')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return entry;
}

async function getCustomerBalance(storeId, customerName) {
  const { data, error } = await supabase
    .from('udhaar_ledger')
    .select('amount, type')
    .eq('store_id', storeId)
    .ilike('customer_name', `%${customerName}%`);
  if (error) throw error;

  const balance = (data || []).reduce((sum, entry) => {
    return entry.type === 'credit' ? sum + Number(entry.amount) : sum - Number(entry.amount);
  }, 0);
  return balance;
}

async function getAllUdhaarBalances(storeId) {
  const { data, error } = await supabase
    .from('udhaar_ledger')
    .select('customer_name, amount, type')
    .eq('store_id', storeId);
  if (error) throw error;

  const balances = {};
  (data || []).forEach((entry) => {
    if (!balances[entry.customer_name]) balances[entry.customer_name] = 0;
    balances[entry.customer_name] +=
      entry.type === 'credit' ? Number(entry.amount) : -Number(entry.amount);
  });

  return Object.entries(balances)
    .filter(([, balance]) => balance > 0)
    .map(([customer_name, balance]) => ({ customer_name, balance }))
    .sort((a, b) => b.balance - a.balance);
}

// --- Bill Photos ---
async function createBillPhoto(data) {
  const { data: photo, error } = await supabase
    .from('bill_photos')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return photo;
}

async function confirmBillPhoto(photoId) {
  const { error } = await supabase
    .from('bill_photos')
    .update({ confirmed: true })
    .eq('id', photoId);
  if (error) throw error;
}

// --- Reorders ---
async function createReorder(data) {
  const { data: reorder, error } = await supabase
    .from('reorders')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return reorder;
}

async function getPendingReorders(storeId) {
  const { data, error } = await supabase
    .from('reorders')
    .select('*, products(name, unit)')
    .eq('store_id', storeId)
    .eq('status', 'pending');
  if (error) throw error;
  return data || [];
}

// --- Error Logging ---
async function logError(storeId, errorType, payload, message) {
  const { error } = await supabase.from('errors').insert({
    store_id: storeId || null,
    error_type: errorType,
    payload,
    message,
  });
  if (error) console.error('Failed to log error to Supabase:', error);
}

module.exports = {
  supabase,
  getStoreByPhone,
  createStore,
  updateStore,
  updateConversationState,
  getProducts,
  getProductByName,
  createProduct,
  updateProductStock,
  getLowStockProducts,
  createSupplier,
  getSupplierByName,
  createStockMovement,
  getLastMovement,
  undoMovement,
  getTodaySales,
  createUdhaarEntry,
  getCustomerBalance,
  getAllUdhaarBalances,
  createBillPhoto,
  confirmBillPhoto,
  createReorder,
  getPendingReorders,
  logError,
};

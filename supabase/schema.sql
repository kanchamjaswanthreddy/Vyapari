-- Vyapari Database Schema
-- Run this in Supabase SQL Editor to set up all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- STORES — one record per registered store owner
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name        TEXT NOT NULL DEFAULT '',
  shop_name         TEXT NOT NULL DEFAULT '',
  whatsapp_number   TEXT UNIQUE NOT NULL,
  city              TEXT,
  state             TEXT,
  language_pref     TEXT DEFAULT 'hindi',   -- hindi | telugu | english
  conversation_state TEXT DEFAULT 'IDLE',
  state_data        JSONB DEFAULT '{}',
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SUPPLIERS — per store
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID REFERENCES stores(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  whatsapp_number  TEXT NOT NULL,
  payment_terms    TEXT,
  language_pref    TEXT DEFAULT 'hindi',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PRODUCTS — per store, tracks current inventory
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              UUID REFERENCES stores(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  unit                  TEXT NOT NULL DEFAULT 'pieces',
  current_stock         NUMERIC DEFAULT 0,
  low_stock_threshold   NUMERIC DEFAULT 0,
  primary_supplier_id   UUID REFERENCES suppliers(id),
  last_reorder_qty      NUMERIC,
  last_alert_sent_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BILL_PHOTOS — stores meta + AI parse results
-- ============================================================
CREATE TABLE IF NOT EXISTS bill_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID REFERENCES stores(id) ON DELETE CASCADE,
  photo_url       TEXT NOT NULL,
  ai_parsed_data  JSONB,
  confirmed       BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STOCK_MOVEMENTS — every IN and OUT transaction
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID REFERENCES stores(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id),
  movement_type  TEXT NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
  quantity       NUMERIC NOT NULL,
  source         TEXT,   -- photo | text | voice | qr | manual
  customer_name  TEXT,
  notes          TEXT,
  bill_photo_id  UUID REFERENCES bill_photos(id),
  is_undone      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REORDERS — supplier reorder log
-- ============================================================
CREATE TABLE IF NOT EXISTS reorders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID REFERENCES stores(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES products(id),
  supplier_id      UUID REFERENCES suppliers(id),
  quantity_ordered NUMERIC NOT NULL,
  message_sent     TEXT,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'delivered', 'cancelled')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- UDHAAR_LEDGER — customer credit tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS udhaar_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID REFERENCES stores(id) ON DELETE CASCADE,
  customer_name     TEXT NOT NULL,
  customer_whatsapp TEXT,
  amount            NUMERIC NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('credit', 'payment')),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ERRORS — operational error log
-- ============================================================
CREATE TABLE IF NOT EXISTS errors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID REFERENCES stores(id),
  error_type  TEXT,
  payload     JSONB,
  message     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES for common queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_stores_whatsapp ON stores(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_date ON stock_movements(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_udhaar_store ON udhaar_ledger(store_id, customer_name);
CREATE INDEX IF NOT EXISTS idx_reorders_store ON reorders(store_id, status);

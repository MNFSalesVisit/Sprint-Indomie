-- Safe performance indexes for the Salesperson module.
-- All use CREATE INDEX IF NOT EXISTS — fully non-destructive and re-runnable.

-- ── Shops ────────────────────────────────────────────────────────────────────
-- Used by GET /api/sales/shops?subregion_id=X on every subregion change.
CREATE INDEX IF NOT EXISTS idx_shops_subregion_id
  ON shops(subregion_id);

-- Used by the bounding-box query in /api/sales/nearby-shops.
-- Composite (region_id, latitude, longitude): region_id equality scan first
-- (high selectivity), then latitude/longitude range scan within that set.
CREATE INDEX IF NOT EXISTS idx_shops_region_lat_lng
  ON shops(region_id, latitude, longitude);

-- Used by duplicate-detection scan in POST /api/sales/shops.
CREATE INDEX IF NOT EXISTS idx_shops_region_id
  ON shops(region_id);

-- ── Subregions ───────────────────────────────────────────────────────────────
-- Used by GET /api/sales/subregions and the new /api/sales/meta on every load.
CREATE INDEX IF NOT EXISTS idx_subregions_region_id
  ON subregions(region_id);

-- ── User ↔ Region ────────────────────────────────────────────────────────────
-- user_regions already has a composite PK (user_id, region_id) which is indexed.
-- No additional index needed.

-- ── Visit history ────────────────────────────────────────────────────────────
-- Used by GET /api/sales/history and dashboard aggregations.
CREATE INDEX IF NOT EXISTS idx_visits_user_id
  ON visits(user_id);

CREATE INDEX IF NOT EXISTS idx_visits_created_at
  ON visits(created_at DESC);

-- ── Uplift history ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_uplifts_user_id
  ON uplifts(user_id);

CREATE INDEX IF NOT EXISTS idx_uplifts_status
  ON uplifts(status);

CREATE INDEX IF NOT EXISTS idx_uplifts_created_at
  ON uplifts(created_at DESC);

-- ── Cascade lookup tables ────────────────────────────────────────────────────
-- visit_items and uplift_items are joined by visit/uplift id on every detail load.
CREATE INDEX IF NOT EXISTS idx_visit_items_visit_id
  ON visit_items(visit_id);

CREATE INDEX IF NOT EXISTS idx_uplift_items_uplift_id
  ON uplift_items(uplift_id);

-- ── Stock balances ───────────────────────────────────────────────────────────
-- Used by GET /api/sales/stock on every Step 1 → Step 2 transition.
CREATE INDEX IF NOT EXISTS idx_stock_balances_user_id
  ON stock_balances(user_id);

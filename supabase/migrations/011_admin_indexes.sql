-- Admin module performance indexes.
-- All use CREATE INDEX IF NOT EXISTS — fully non-destructive and re-runnable.

-- ── Visits ───────────────────────────────────────────────────────────────────
-- Filtered by visit_type ('Sales', 'Merchandising', etc.) in performance,
-- customer-analysis, and sku-analysis APIs.
CREATE INDEX IF NOT EXISTS idx_visits_visit_type
  ON visits(visit_type);

-- Used when filtering visits by shop (customer-insights, map-data, master-data).
CREATE INDEX IF NOT EXISTS idx_visits_shop_id
  ON visits(shop_id);

-- Composite for region-scoped admin queries that filter by user_id + date range.
-- Extends the benefit of existing idx_visits_user_id with the date dimension.
CREATE INDEX IF NOT EXISTS idx_visits_user_created
  ON visits(user_id, created_at DESC);

-- ── Uplifts ──────────────────────────────────────────────────────────────────
-- Used by dashboard.js, uplifts/index.js, and map-data.js when admins have
-- region restrictions and must filter uplifts by shop_id.
CREATE INDEX IF NOT EXISTS idx_uplifts_shop_id
  ON uplifts(shop_id);

-- ── App users ────────────────────────────────────────────────────────────────
-- performance.js finds all salespersons via .eq('role_id', salesRoleId).
CREATE INDEX IF NOT EXISTS idx_app_users_role_id
  ON app_users(role_id);

-- ── Targets ─────────────────────────────────────────────────────────────────
-- Composite used by performance.js to look up each user's monthly target.
CREATE INDEX IF NOT EXISTS idx_targets_user_year_month
  ON targets(user_id, year, month);

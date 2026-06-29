-- Migration 017: Manager module optional feature flags
-- Required Manager tabs (performance, map) are hardcoded in admin/index.js — no DB rows needed.
-- This seeds the optional tabs that Super Admin can toggle.

INSERT INTO features (key, name, enabled) VALUES
  ('mgr_dashboard',   'Dashboard (Manager)',          true),
  ('mgr_fuel',        'Fuel Management (Manager)',    true),
  ('mgr_targets',     'Targets (Manager)',            true),
  ('mgr_customer',    'Customer Analysis (Manager)',  true),
  ('mgr_competitor',  'Competitor Analysis (Manager)', true)
ON CONFLICT (key) DO NOTHING;

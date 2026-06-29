-- Sales module tab feature flags.
-- Uses 'sales_' prefix to avoid collision with Admin tab keys in the same table.
-- Required Sales tabs (visit, uplift, stock) are NOT seeded here — they are hardcoded
-- and can never be hidden. Only optional tabs are controlled here.

INSERT INTO features (key, name, enabled) VALUES
  ('sales_dashboard',    'Dashboard (Sales)',     true),
  ('sales_history',      'Daily Visit Log',       true),
  ('sales_performance',  'My Performance',        true),
  ('sales_profile',      'Profile',               true)
ON CONFLICT (key) DO NOTHING;

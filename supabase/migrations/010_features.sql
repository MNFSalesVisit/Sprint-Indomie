-- Feature flags table for Admin module tab visibility.
-- Controlled exclusively by Super Admin via the Feature Management tab.

CREATE TABLE IF NOT EXISTS features (
  id         serial       PRIMARY KEY,
  key        text         NOT NULL UNIQUE,  -- matches Admin TABS id, e.g. 'fuel', 'customer'
  name       text         NOT NULL,          -- human-readable label shown in Super Admin UI
  enabled    boolean      NOT NULL DEFAULT true,
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- Seed the toggleable Admin tabs.
-- Required tabs (dashboard, uplifts, performance, targets) are intentionally NOT seeded here
-- because they are hardcoded in the Admin module and can never be hidden.
INSERT INTO features (key, name, enabled) VALUES
  ('map',        'Map',                 true),
  ('customer',   'Customer Analysis',   true),
  ('competitor', 'Competitor Analysis', true),
  ('fuel',       'Fuel Management',     true)
ON CONFLICT (key) DO NOTHING;

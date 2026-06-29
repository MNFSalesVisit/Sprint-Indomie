-- No-sale reasons table.
-- Super Admin can manage these via the Custom Configurations tab.
-- The Sales page reads them so they are never hardcoded in the frontend.

CREATE TABLE IF NOT EXISTS no_sale_reasons (
  id          serial        PRIMARY KEY,
  label       text          NOT NULL,
  is_active   boolean       NOT NULL DEFAULT true,
  sort_order  integer       NOT NULL DEFAULT 0,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

-- Seed the three reasons that were previously hardcoded in the frontend.
-- Using sort_order 10/20/30 leaves room to insert new ones between them.
INSERT INTO no_sale_reasons (label, is_active, sort_order) VALUES
  ('Financial constraints',  true, 10),
  ('Stock available',        true, 20),
  ('Shop owner not around',  true, 30),
  ('Other (enter manually)', true, 40)
ON CONFLICT DO NOTHING;

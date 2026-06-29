-- Add is_active and sort_order columns to competitor_products table
ALTER TABLE competitor_products
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE competitor_products
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Back-fill sort_order so existing rows get a sensible order (by id)
UPDATE competitor_products SET sort_order = id * 10 WHERE sort_order = 0;

-- Add sort_order to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Back-fill sort_order for existing products
UPDATE products SET sort_order = id * 10 WHERE sort_order = 0;

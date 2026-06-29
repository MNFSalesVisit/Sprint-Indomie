-- Add location & stock-after tracking to uplifts / uplift_items

ALTER TABLE uplifts
  ADD COLUMN IF NOT EXISTS region_id    int  references regions(id),
  ADD COLUMN IF NOT EXISTS subregion_id int  references subregions(id),
  ADD COLUMN IF NOT EXISTS latitude     double precision,
  ADD COLUMN IF NOT EXISTS longitude    double precision;

ALTER TABLE uplift_items
  ADD COLUMN IF NOT EXISTS stock_after      int  not null default 0,
  ADD COLUMN IF NOT EXISTS stock_after_unit text not null default 'cartons';

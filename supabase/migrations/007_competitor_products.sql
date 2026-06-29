-- Create competitor_products mapping table per region
create table if not exists competitor_products (
  id serial primary key,
  region_id int references regions(id) on delete cascade,
  name text not null,
  note text,
  created_by uuid references app_users(id),
  created_at timestamptz default now(),
  unique(region_id, name)
);

-- Index to speed region lookups
create index if not exists idx_competitor_products_region on competitor_products(region_id);

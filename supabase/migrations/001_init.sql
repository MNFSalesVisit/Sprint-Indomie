-- Initial schema for Sales Visit System
-- Extensions
create extension if not exists "pgcrypto";

-- Enums
create type vehicle_type as enum ('motorbike','van','bicycle');
create type visit_type as enum ('sales','uplift');
create type uplift_status as enum ('pending','approved','rejected');

-- Roles
create table roles (
  id serial primary key,
  name text not null unique
);

-- Users
create table app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role_id int references roles(id) on delete set null,
  vehicle vehicle_type,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Regions & Subregions
create table regions (
  id serial primary key,
  name text not null unique
);

create table subregions (
  id serial primary key,
  region_id int references regions(id) on delete cascade,
  name text not null,
  unique(region_id, name)
);

-- User to Region assignment (many-to-many)
create table user_regions (
  user_id uuid references app_users(id) on delete cascade,
  region_id int references regions(id) on delete cascade,
  primary key (user_id, region_id)
);

-- Products / SKUs
create table products (
  id serial primary key,
  sku text not null unique,
  name text not null,
  is_active boolean default true
);

-- Shops / Outlets
create table shops (
  id serial primary key,
  name text not null,
  location text,
  region_id int references regions(id),
  subregion_id int references subregions(id),
  latitude double precision,
  longitude double precision,
  created_by uuid references app_users(id),
  created_at timestamptz default now()
);

-- Stock Balances per salesperson and product
create table stock_balances (
  id serial primary key,
  user_id uuid references app_users(id) on delete cascade,
  product_id int references products(id) on delete cascade,
  quantity int not null default 0,
  last_updated timestamptz default now(),
  unique(user_id, product_id)
);

-- Visits (sales or uplift)
create table visits (
  id serial primary key,
  user_id uuid references app_users(id) on delete set null,
  shop_id int references shops(id) on delete set null,
  region_id int references regions(id),
  subregion_id int references subregions(id),
  visit_type visit_type not null,
  latitude double precision,
  longitude double precision,
  selfie_path text,
  created_at timestamptz default now()
);

-- Visit items (per SKU): stock position and sold quantity
create table visit_items (
  id serial primary key,
  visit_id int references visits(id) on delete cascade,
  product_id int references products(id) on delete cascade,
  stock_position int not null default 0,
  sold int not null default 0,
  not_sold_reason text
);

-- Uplifts (requests)
create table uplifts (
  id serial primary key,
  user_id uuid references app_users(id) on delete set null,
  shop_id int references shops(id) on delete set null,
  cartons int not null,
  status uplift_status default 'pending',
  receipt_path text,
  created_at timestamptz default now(),
  approved_by uuid references app_users(id),
  approved_at timestamptz,
  rejected_reason text
);

-- Uplift items (if per-SKU needed)
create table uplift_items (
  id serial primary key,
  uplift_id int references uplifts(id) on delete cascade,
  product_id int references products(id) on delete cascade,
  cartons int not null default 0
);

-- Targets
create table targets (
  id serial primary key,
  user_id uuid references app_users(id) on delete cascade,
  year int not null,
  month int not null,
  cartons_target int not null,
  unique(user_id, year, month)
);

-- Audit logs
create table audit_logs (
  id serial primary key,
  actor_id uuid references app_users(id),
  action text not null,
  entity text,
  entity_id text,
  details jsonb,
  created_at timestamptz default now()
);

-- Indexes for common queries
create index idx_visits_user_created on visits(user_id, created_at);
create index idx_uplifts_status on uplifts(status);
create index idx_stock_user_product on stock_balances(user_id, product_id);

-- Placeholder RLS policy notes (to be implemented per environment)
-- Example: enable row level security on sensitive tables and create policies
-- ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can manage their own visits" ON visits USING (auth.uid() = user_id::text);

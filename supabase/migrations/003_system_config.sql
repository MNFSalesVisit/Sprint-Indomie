-- System-wide configuration key/value store
create table if not exists system_config (
  key         text primary key,
  value       text not null default '',
  updated_at  timestamptz not null default now()
);

-- Seed default values (no-op if already present)
insert into system_config (key, value) values
  ('company_name',     ''),
  ('company_logo',     ''),
  ('contact_email',    ''),
  ('contact_phone',    ''),
  ('business_address', ''),
  ('system_name',      'Sales Visit System'),
  ('theme_color',      '#7c3aed'),
  ('accent_color',     '#06b6d4')
on conflict (key) do nothing;

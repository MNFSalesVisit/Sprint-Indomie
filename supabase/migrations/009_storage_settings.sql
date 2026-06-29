-- Storage settings for file management (selfies & receipts)

CREATE TABLE IF NOT EXISTS storage_settings (
  id                    serial primary key,
  file_type             text not null unique check (file_type in ('selfie', 'receipt')),
  max_size_bytes        bigint not null default 2097152,   -- 2 MB
  retention_value       int    not null default 30,
  retention_unit        text   not null default 'days' check (retention_unit in ('days', 'weeks', 'months')),
  compression_enabled   boolean not null default true,     -- applies to selfies only
  compression_quality   int    not null default 70 check (compression_quality between 10 and 100),
  updated_at            timestamptz not null default now()
);

-- Seed default values
INSERT INTO storage_settings
  (file_type, max_size_bytes, retention_value, retention_unit, compression_enabled, compression_quality)
VALUES
  ('selfie',  2097152,  30, 'days', true,  70),
  ('receipt', 5242880,  90, 'days', false, 100)
ON CONFLICT (file_type) DO NOTHING;

-- Track file sizes per visit / uplift for storage usage display
ALTER TABLE visits  ADD COLUMN IF NOT EXISTS selfie_size_bytes  bigint;
ALTER TABLE uplifts ADD COLUMN IF NOT EXISTS receipt_size_bytes bigint;

-- Cleanup log table
CREATE TABLE IF NOT EXISTS storage_cleanup_log (
  id            serial primary key,
  file_type     text not null,
  file_path     text not null,
  file_size     bigint,
  deleted_at    timestamptz not null default now(),
  triggered_by  text not null default 'auto'  -- 'auto' | 'manual'
);

-- Add avatar_url to app_users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url text;

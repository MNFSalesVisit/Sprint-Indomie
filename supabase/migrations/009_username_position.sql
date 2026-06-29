-- Migration 009: Add username and position fields to app_users
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING guards)

-- Add username column (unique, nullable — old users will have NULL)
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS username text;

-- Enforce uniqueness only on non-null values
CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique
  ON app_users (lower(username))
  WHERE username IS NOT NULL;

-- Add position column (free-text, nullable)
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS position text;

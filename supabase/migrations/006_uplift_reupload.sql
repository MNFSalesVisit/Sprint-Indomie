-- Add receipt-reupload tracking columns to uplifts
ALTER TABLE uplifts
  ADD COLUMN IF NOT EXISTS is_reuploaded  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reupload_count int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reupload_note  text;

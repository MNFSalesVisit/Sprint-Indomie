-- Create the visit-media storage bucket (private) for receipts and selfies.
-- Uses INSERT ... ON CONFLICT so re-running is safe.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'visit-media',
  'visit-media',
  false,              -- private: access only via signed URLs
  10485760,           -- 10 MB per file
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies ──────────────────────────────────────────────────────────────

-- Allow authenticated salespersons to upload files into their own folder.
-- Path format: receipts/{user_uuid}/... or selfies/{user_uuid}/...
CREATE POLICY "Salespersons can upload their own files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'visit-media'
  AND (storage.foldername(name))[1] IN ('receipts', 'selfies')
);

-- Allow service-role full access (used by API routes to generate signed URLs).
-- Service role bypasses RLS by default, so no explicit policy needed for it.

-- Allow authenticated users to read their own files (for self-access if needed).
CREATE POLICY "Users can read their own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'visit-media'
  AND auth.uid()::text = (storage.foldername(name))[2]
);

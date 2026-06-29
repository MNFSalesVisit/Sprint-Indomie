-- Function to sum all file sizes in Supabase Storage buckets
-- Called via supabase.rpc('get_file_storage_size') by service-role
CREATE OR REPLACE FUNCTION get_file_storage_size()
RETURNS TABLE (size_bytes bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)::bigint AS size_bytes
  FROM storage.objects;
$$;

-- Function callable via supabase.rpc('get_db_size') by service-role
CREATE OR REPLACE FUNCTION get_db_size()
RETURNS TABLE (size_bytes bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_database_size(current_database())::bigint AS size_bytes;
$$;

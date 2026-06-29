/**
 * GET /api/sales/storage-settings
 *   Returns compression and size-limit settings for the sales client.
 *   Used on the sales page to configure selfie compression and validate uploads.
 *   Requires Salesperson authentication.
 */
import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DEFAULTS = {
  selfie:  { max_size_bytes: 2097152,  compression_enabled: true,  compression_quality: 70 },
  receipt: { max_size_bytes: 5242880,  compression_enabled: false, compression_quality: 100 },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Must be Salesperson
  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (!appUser || appUser.roles?.name !== 'Salesperson') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: rows } = await adminSupabase
    .from('storage_settings')
    .select('file_type, max_size_bytes, compression_enabled, compression_quality')
    .in('file_type', ['selfie', 'receipt']);

  // If table doesn't exist yet, rows will be null — fall through to defaults below
  const selfieRow   = (rows || []).find(r => r.file_type === 'selfie');
  const receiptRow  = (rows || []).find(r => r.file_type === 'receipt');

  // Short cache — settings rarely change
  res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');

  return res.status(200).json({
    selfie: {
      maxSizeBytes:       selfieRow?.max_size_bytes       ?? DEFAULTS.selfie.max_size_bytes,
      compressionEnabled: selfieRow?.compression_enabled  ?? DEFAULTS.selfie.compression_enabled,
      compressionQuality: selfieRow?.compression_quality  ?? DEFAULTS.selfie.compression_quality,
    },
    receipt: {
      maxSizeBytes: receiptRow?.max_size_bytes ?? DEFAULTS.receipt.max_size_bytes,
    },
  });
}

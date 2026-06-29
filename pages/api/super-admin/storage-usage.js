/**
 * GET /api/super-admin/storage-usage
 *   Returns total bytes stored for selfies and receipts, plus the configured limit.
 *   { selfieBytes, receiptBytes, totalBytes, limitBytes }
 *
 * Super Admin only.
 */
import { adminSupabase } from '../../../lib/adminAuth';

async function verifySuperAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return false;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: appUser } = await adminSupabase
    .from('app_users').select('role_id').eq('email', data.user.email).single();
  if (!appUser) return false;
  const { data: role } = await adminSupabase
    .from('roles').select('name').eq('id', appUser.role_id).single();
  return role?.name === 'Super Admin';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  // Sum selfie sizes from visits
  const { data: selfieAgg, error: selfieErr } = await adminSupabase
    .from('visits')
    .select('selfie_size_bytes')
    .not('selfie_size_bytes', 'is', null);

  // Sum receipt sizes from uplifts
  const { data: receiptAgg, error: receiptErr } = await adminSupabase
    .from('uplifts')
    .select('receipt_size_bytes')
    .not('receipt_size_bytes', 'is', null);

  if (selfieErr || receiptErr) {
    const msg = (selfieErr || receiptErr).message || '';
    // If the selfie_size_bytes column doesn't exist yet (migration pending), return zeros
    if (msg.includes('selfie_size_bytes') || msg.includes('receipt_size_bytes')) {
      return res.status(200).json({
        selfieBytes: 0, receiptBytes: 0, totalBytes: 0, limitBytes: 1073741824,
        selfieCount: 0, receiptCount: 0, totalSelfieFiles: 0, totalReceiptFiles: 0,
        _migrationPending: true,
      });
    }
    return res.status(500).json({ error: msg });
  }

  const selfieBytes  = (selfieAgg  || []).reduce((s, r) => s + (r.selfie_size_bytes  || 0), 0);
  const receiptBytes = (receiptAgg || []).reduce((s, r) => s + (r.receipt_size_bytes || 0), 0);
  const totalBytes   = selfieBytes + receiptBytes;

  // Get file storage limit from system_config
  const { data: limitRow } = await adminSupabase
    .from('system_config')
    .select('value')
    .eq('key', 'file_storage_limit')
    .single();

  const limitBytes = limitRow?.value && parseInt(limitRow.value, 10) > 0
    ? parseInt(limitRow.value, 10)
    : 1024 * 1024 * 1024; // 1 GB default

  // Counts
  const selfieCount  = (selfieAgg  || []).length;
  const receiptCount = (receiptAgg || []).length;

  // Files without size tracking (uploaded before this feature)
  const { count: totalVisitsWithSelfie } = await adminSupabase
    .from('visits')
    .select('id', { count: 'exact', head: true })
    .not('selfie_path', 'is', null);

  const { count: totalUpliftsWithReceipt } = await adminSupabase
    .from('uplifts')
    .select('id', { count: 'exact', head: true })
    .not('receipt_path', 'is', null);

  return res.status(200).json({
    selfieBytes,
    receiptBytes,
    totalBytes,
    limitBytes,
    selfieCount,
    receiptCount,
    totalSelfieFiles:  totalVisitsWithSelfie  || 0,
    totalReceiptFiles: totalUpliftsWithReceipt || 0,
  });
}

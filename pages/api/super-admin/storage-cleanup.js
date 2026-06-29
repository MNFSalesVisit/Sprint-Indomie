/**
 * POST /api/super-admin/storage-cleanup
 *   Body: { fileType: 'selfie' | 'receipt' | 'all', triggeredBy?: 'manual' | 'auto' }
 *   Deletes files older than the configured retention period from Supabase Storage
 *   and nulls the path column in the DB. Logs each deletion.
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

function retentionCutoff(value, unit) {
  const d = new Date();
  switch (unit) {
    case 'weeks':  d.setDate(d.getDate() - value * 7);  break;
    case 'months': d.setMonth(d.getMonth() - value);    break;
    default:       d.setDate(d.getDate() - value);       break; // days
  }
  return d.toISOString();
}

async function cleanupSelfies(settings, triggeredBy) {
  const { retention_value, retention_unit } = settings;
  const cutoff = retentionCutoff(retention_value, retention_unit);

  const { data: rows, error } = await adminSupabase
    .from('visits')
    .select('id, selfie_path, selfie_size_bytes')
    .not('selfie_path', 'is', null)
    .lt('created_at', cutoff)
    .limit(500);

  if (error) throw error;
  if (!rows || rows.length === 0) return { deleted: 0, errors: 0 };

  let deleted = 0, errors = 0;
  for (const row of rows) {
    if (!row.selfie_path) continue;
    try {
      const bucket = row.selfie_path.startsWith('selfies/') ? 'selfies' : 'visit-media';
      const { error: rmErr } = await adminSupabase.storage
        .from(bucket)
        .remove([row.selfie_path]);
      if (rmErr) { console.warn('Storage remove error:', rmErr.message); errors++; continue; }

      await adminSupabase.from('visits')
        .update({ selfie_path: null })
        .eq('id', row.id);

      await adminSupabase.from('storage_cleanup_log').insert({
        file_type:    'selfie',
        file_path:    row.selfie_path,
        file_size:    row.selfie_size_bytes || null,
        triggered_by: triggeredBy,
      });
      deleted++;
    } catch (e) {
      console.error('Cleanup selfie error:', e.message);
      errors++;
    }
  }
  return { deleted, errors };
}

async function cleanupReceipts(settings, triggeredBy) {
  const { retention_value, retention_unit } = settings;
  const cutoff = retentionCutoff(retention_value, retention_unit);

  // Cleanup from uplifts
  const { data: upliftRows, error: upliftErr } = await adminSupabase
    .from('uplifts')
    .select('id, receipt_path, receipt_size_bytes')
    .not('receipt_path', 'is', null)
    .lt('created_at', cutoff)
    .limit(500);

  if (upliftErr) throw upliftErr;

  let deleted = 0, errors = 0;
  for (const row of (upliftRows || [])) {
    if (!row.receipt_path) continue;
    try {
      const { error: rmErr } = await adminSupabase.storage
        .from('visit-media')
        .remove([row.receipt_path]);
      if (rmErr) { console.warn('Storage remove error:', rmErr.message); errors++; continue; }

      await adminSupabase.from('uplifts')
        .update({ receipt_path: null })
        .eq('id', row.id);

      await adminSupabase.from('storage_cleanup_log').insert({
        file_type:    'receipt',
        file_path:    row.receipt_path,
        file_size:    row.receipt_size_bytes || null,
        triggered_by: triggeredBy,
      });
      deleted++;
    } catch (e) {
      console.error('Cleanup receipt error:', e.message);
      errors++;
    }
  }
  return { deleted, errors };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const { fileType = 'all', triggeredBy = 'manual' } = req.body ?? {};

  if (!['selfie', 'receipt', 'all'].includes(fileType)) {
    return res.status(400).json({ error: 'fileType must be selfie, receipt, or all' });
  }

  // Load settings
  const { data: settingsRows, error: settErr } = await adminSupabase
    .from('storage_settings')
    .select('*')
    .in('file_type', ['selfie', 'receipt']);

  if (settErr) {
    if (settErr.message?.includes('storage_settings')) {
      return res.status(503).json({ error: 'Migration 009_storage_settings.sql has not been applied yet. Please run it in your Supabase SQL editor.' });
    }
    return res.status(500).json({ error: settErr.message });
  }

  const selfieSettings  = (settingsRows || []).find(r => r.file_type === 'selfie')  || { retention_value: 30, retention_unit: 'days' };
  const receiptSettings = (settingsRows || []).find(r => r.file_type === 'receipt') || { retention_value: 90, retention_unit: 'days' };

  const results = {};
  try {
    if (fileType === 'selfie' || fileType === 'all') {
      results.selfie = await cleanupSelfies(selfieSettings, triggeredBy);
    }
    if (fileType === 'receipt' || fileType === 'all') {
      results.receipt = await cleanupReceipts(receiptSettings, triggeredBy);
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(200).json({ success: true, results });
}

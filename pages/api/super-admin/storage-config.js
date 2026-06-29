/**
 * GET  /api/super-admin/storage-config
 *   Returns storage settings for selfie and receipt:
 *   { selfie: { maxSizeBytes, retentionValue, retentionUnit, compressionEnabled, compressionQuality },
 *     receipt: { maxSizeBytes, retentionValue, retentionUnit } }
 *
 * POST /api/super-admin/storage-config
 *   Body: { fileType: 'selfie'|'receipt', maxSizeBytes, retentionValue, retentionUnit,
 *           compressionEnabled?, compressionQuality? }
 *
 * Super Admin only.
 */
import { adminSupabase } from '../../../lib/adminAuth';

const DEFAULTS = {
  selfie:  { max_size_bytes: 2097152,  retention_value: 30,  retention_unit: 'days', compression_enabled: true,  compression_quality: 70 },
  receipt: { max_size_bytes: 5242880,  retention_value: 90,  retention_unit: 'days', compression_enabled: false, compression_quality: 100 },
};

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

function mapRow(row, fileType) {
  const d = DEFAULTS[fileType];
  if (!row) return d;
  return {
    max_size_bytes:       row.max_size_bytes       ?? d.max_size_bytes,
    retention_value:      row.retention_value      ?? d.retention_value,
    retention_unit:       row.retention_unit       ?? d.retention_unit,
    compression_enabled:  row.compression_enabled  ?? d.compression_enabled,
    compression_quality:  row.compression_quality  ?? d.compression_quality,
  };
}

export default async function handler(req, res) {
  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'GET') {
    const { data: rows, error } = await adminSupabase
      .from('storage_settings')
      .select('*')
      .in('file_type', ['selfie', 'receipt']);

    // If table doesn't exist yet (migration pending), return defaults
    if (error) {
      return res.status(200).json({
        selfie:  DEFAULTS.selfie,
        receipt: DEFAULTS.receipt,
        _migrationPending: true,
      });
    }

    const selfieRow   = (rows || []).find(r => r.file_type === 'selfie');
    const receiptRow  = (rows || []).find(r => r.file_type === 'receipt');

    return res.status(200).json({
      selfie:  mapRow(selfieRow,  'selfie'),
      receipt: mapRow(receiptRow, 'receipt'),
    });
  }

  if (req.method === 'POST') {
    const {
      fileType,
      maxSizeBytes,
      retentionValue,
      retentionUnit,
      compressionEnabled,
      compressionQuality,
    } = req.body ?? {};

    if (!['selfie', 'receipt'].includes(fileType)) {
      return res.status(400).json({ error: 'fileType must be selfie or receipt' });
    }

    // Validate sizes
    const MIN_SIZE = 100 * 1024; // 100 KB
    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
    if (maxSizeBytes !== undefined) {
      const n = Number(maxSizeBytes);
      if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
        return res.status(400).json({ error: `maxSizeBytes must be between 100 KB and 50 MB` });
      }
    }

    if (retentionValue !== undefined) {
      const n = Number(retentionValue);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        return res.status(400).json({ error: 'retentionValue must be between 1 and 3650' });
      }
    }

    if (retentionUnit !== undefined && !['days', 'weeks', 'months'].includes(retentionUnit)) {
      return res.status(400).json({ error: 'retentionUnit must be days, weeks, or months' });
    }

    if (compressionQuality !== undefined) {
      const n = Number(compressionQuality);
      if (!Number.isInteger(n) || n < 10 || n > 100) {
        return res.status(400).json({ error: 'compressionQuality must be between 10 and 100' });
      }
    }

    const patch = { updated_at: new Date().toISOString() };
    if (maxSizeBytes      !== undefined) patch.max_size_bytes      = Number(maxSizeBytes);
    if (retentionValue    !== undefined) patch.retention_value     = Number(retentionValue);
    if (retentionUnit     !== undefined) patch.retention_unit      = retentionUnit;
    if (fileType === 'selfie') {
      if (compressionEnabled !== undefined) patch.compression_enabled = Boolean(compressionEnabled);
      if (compressionQuality !== undefined) patch.compression_quality = Number(compressionQuality);
    }

    const { data: updated, error: upsertErr } = await adminSupabase
      .from('storage_settings')
      .upsert({ file_type: fileType, ...patch }, { onConflict: 'file_type' })
      .select('*')
      .single();

    if (upsertErr) {
      if (upsertErr.message?.includes('storage_settings')) {
        return res.status(503).json({ error: 'Migration 009_storage_settings.sql has not been applied yet. Please run it in your Supabase SQL editor.' });
      }
      return res.status(500).json({ error: upsertErr.message });
    }

    return res.status(200).json({ success: true, row: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

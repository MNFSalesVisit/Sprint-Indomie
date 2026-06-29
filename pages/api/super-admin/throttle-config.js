/**
 * GET  /api/super-admin/throttle-config
 *   Returns { enabled: boolean }
 *
 * POST /api/super-admin/throttle-config
 *   Body: { enabled: boolean }
 *   Returns { enabled: boolean }
 *
 * Super Admin only.
 */
import { adminSupabase } from '../../../lib/adminAuth';
import { deleteCache } from '../../../lib/serverCache';

const EDGE_LIMIT_DEFAULT     = 1_000_000;
const DB_SIZE_LIMIT_DEFAULT   = 500  * 1024 * 1024;  // 500 MB
const FILE_STORAGE_LIMIT_DEFAULT = 1024 * 1024 * 1024; //   1 GB

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
  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'GET') {
    const [{ data: enabledRow }, { data: edgeLimitRow }, { data: dbRow }, { data: fileRow }] = await Promise.all([
      adminSupabase.from('system_config').select('value').eq('key', 'throttling_enabled').single(),
      adminSupabase.from('system_config').select('value').eq('key', 'edge_limit').single(),
      adminSupabase.from('system_config').select('value').eq('key', 'db_size_limit').single(),
      adminSupabase.from('system_config').select('value').eq('key', 'file_storage_limit').single(),
    ]);
    const enabled         = enabledRow ? enabledRow.value !== 'false' : true;
    const edgeLimit       = edgeLimitRow?.value && parseInt(edgeLimitRow.value, 10) > 0 ? parseInt(edgeLimitRow.value, 10) : EDGE_LIMIT_DEFAULT;
    const dbSizeLimit     = dbRow?.value       && parseInt(dbRow.value, 10)       > 0 ? parseInt(dbRow.value, 10)       : DB_SIZE_LIMIT_DEFAULT;
    const fileStorageLimit = fileRow?.value    && parseInt(fileRow.value, 10)     > 0 ? parseInt(fileRow.value, 10)     : FILE_STORAGE_LIMIT_DEFAULT;
    return res.status(200).json({ enabled, edgeLimit, dbSizeLimit, fileStorageLimit });
  }

  if (req.method === 'POST') {
    const { enabled, edgeLimit, dbSizeLimit, fileStorageLimit } = req.body ?? {};
    const now = new Date().toISOString();
    const upserts = [];

    if (typeof enabled === 'boolean') {
      upserts.push({ key: 'throttling_enabled', value: String(enabled), updated_at: now });
    }
    if (edgeLimit !== undefined) {
      const v = parseInt(edgeLimit, 10);
      if (!Number.isFinite(v) || v < 1000) return res.status(400).json({ error: 'edgeLimit must be an integer ≥ 1000' });
      upserts.push({ key: 'edge_limit', value: String(v), updated_at: now });
    }
    if (dbSizeLimit !== undefined) {
      const v = parseInt(dbSizeLimit, 10);
      if (!Number.isFinite(v) || v < 1024 * 1024) return res.status(400).json({ error: 'dbSizeLimit must be ≥ 1 MB (in bytes)' });
      upserts.push({ key: 'db_size_limit', value: String(v), updated_at: now });
    }
    if (fileStorageLimit !== undefined) {
      const v = parseInt(fileStorageLimit, 10);
      if (!Number.isFinite(v) || v < 1024 * 1024) return res.status(400).json({ error: 'fileStorageLimit must be ≥ 1 MB (in bytes)' });
      upserts.push({ key: 'file_storage_limit', value: String(v), updated_at: now });
    }
    if (upserts.length === 0) {
      return res.status(400).json({ error: 'Provide at least one of: enabled, edgeLimit, dbSizeLimit, fileStorageLimit' });
    }

    await adminSupabase.from('system_config').upsert(upserts);

    deleteCache('throttle:enabled');
    deleteCache('throttle:state');
    deleteCache('throttle:edge_limit');

    // Return all current values
    const [{ data: enabledRow }, { data: edgeLimitRow }, { data: dbRow }, { data: fileRow }] = await Promise.all([
      adminSupabase.from('system_config').select('value').eq('key', 'throttling_enabled').single(),
      adminSupabase.from('system_config').select('value').eq('key', 'edge_limit').single(),
      adminSupabase.from('system_config').select('value').eq('key', 'db_size_limit').single(),
      adminSupabase.from('system_config').select('value').eq('key', 'file_storage_limit').single(),
    ]);
    return res.status(200).json({
      enabled:          enabledRow  ? enabledRow.value !== 'false' : true,
      edgeLimit:        edgeLimitRow?.value && parseInt(edgeLimitRow.value, 10) > 0 ? parseInt(edgeLimitRow.value, 10) : EDGE_LIMIT_DEFAULT,
      dbSizeLimit:      dbRow?.value       && parseInt(dbRow.value, 10)       > 0 ? parseInt(dbRow.value, 10)       : DB_SIZE_LIMIT_DEFAULT,
      fileStorageLimit: fileRow?.value     && parseInt(fileRow.value, 10)     > 0 ? parseInt(fileRow.value, 10)     : FILE_STORAGE_LIMIT_DEFAULT,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

import { adminSupabase, requireSuperAdmin } from '../../../lib/adminAuth';
import { deleteCache } from '../../../lib/serverCache';

/**
 * GET  /api/admin/features  — returns all feature flags (Super Admin only)
 * PUT  /api/admin/features  — body: { key, enabled }  (Super Admin only)
 */
export default async function handler(req, res) {
  const user = await requireSuperAdmin(req);
  if (!user) return res.status(403).json({ error: 'Super Admin access required' });

  if (req.method === 'GET') {
    const { data, error } = await adminSupabase
      .from('features')
      .select('id, key, name, enabled')
      .order('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  if (req.method === 'PUT') {
    const { key, enabled } = req.body || {};
    if (!key || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'key (string) and enabled (boolean) are required' });
    }
    const { data, error } = await adminSupabase
      .from('features')
      .update({ enabled })
      .eq('key', key)
      .select('id, key, name, enabled')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    // Bust the features-public cache so the next page load picks up the new value immediately
    deleteCache('features-public');
    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

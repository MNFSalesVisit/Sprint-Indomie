import { adminSupabase, requireSuperAdmin } from '../../../lib/adminAuth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    const { data, error } = await adminSupabase
      .from('roles')
      .select('id, name')
      .order('id');

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

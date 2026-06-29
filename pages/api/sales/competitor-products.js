import { adminSupabase } from '../../../lib/adminAuth';

async function getUserAllowedRegions(token) {
  if (!token) return null;
  const result = await adminSupabase.auth.getUser(token);
  const user = result?.data?.user;
  if (result?.error || !user) return null;

  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('id, roles(name), user_regions(region_id)')
    .eq('email', user.email)
    .single();
  if (!appUser) return null;
  const role = appUser.roles?.name;
  const allowedRegionIds = (appUser.user_regions || []).map(r => r.region_id);
  return { id: appUser.id, role, allowedRegionIds };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorised' });

    const actor = await getUserAllowedRegions(token);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');

    const { role, allowedRegionIds } = actor;
    const { region_id } = req.query || {};

    // If region_id is provided, enforce that the user is allowed to view it (unless Super Admin)
    if (region_id) {
      if (role !== 'Super Admin' && allowedRegionIds.length > 0 && !allowedRegionIds.includes(parseInt(region_id))) {
        return res.status(200).json([]);
      }
      const { data, error } = await adminSupabase
        .from('competitor_products')
        .select('id, region_id, name, note, sort_order')
        .eq('region_id', Number(region_id))
        .order('sort_order')
        .order('id');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data ?? []);
    }

    // No region_id — return products for allowed regions only (Super Admin returns all)
    let q = adminSupabase.from('competitor_products').select('id, region_id, name, note, sort_order').order('sort_order').order('id');
    if (role !== 'Super Admin') {
      if (!allowedRegionIds || allowedRegionIds.length === 0) return res.status(200).json([]);
      q = q.in('region_id', allowedRegionIds);
    }
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

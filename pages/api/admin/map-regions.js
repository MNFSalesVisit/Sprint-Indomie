import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verifyAdmin(token) {
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('id, roles(name), user_regions(region_id)')
    .eq('email', user.email)
    .single();
  if (!appUser) return null;
  const role = appUser.roles?.name;
  if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;
  const allowedRegionIds = (appUser.user_regions || []).map(r => r.region_id);
  return { id: appUser.id, role, allowedRegionIds };
}

/**
 * GET /api/admin/map-regions            — all regions
 * GET /api/admin/map-regions?region_id=X — subregions for that region
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  const { allowedRegionIds, role } = admin;

  const { region_id } = req.query;

  if (region_id) {
    // If admin has region restrictions, verify this region is allowed (Super Admin sees all regions)
    if (role !== 'Super Admin' && allowedRegionIds.length > 0 && !allowedRegionIds.includes(parseInt(region_id))) {
      return res.status(200).json([]);
    }
    // Return subregions for a given region
    const { data, error } = await adminSupabase
      .from('subregions')
      .select('id, name, region_id')
      .eq('region_id', parseInt(region_id))
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  }

  // Return regions (filtered to assigned ones if restricted)
  let regQ = adminSupabase.from('regions').select('id, name').order('name');
  // Super Admin should see all regions regardless of assignments
  if (role !== 'Super Admin' && allowedRegionIds.length > 0) regQ = regQ.in('id', allowedRegionIds);
  const { data, error } = await regQ;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data ?? []);
}

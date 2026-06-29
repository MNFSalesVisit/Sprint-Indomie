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
 * GET /api/admin/map-users
 * Returns all active salespersons for the map filter dropdown.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  const { allowedRegionIds } = admin;

  // Fetch salesperson role id
  const { data: roleRow } = await adminSupabase
    .from('roles')
    .select('id')
    .eq('name', 'Salesperson')
    .single();

  if (!roleRow) return res.status(200).json([]);

  let usersQ = adminSupabase
    .from('app_users')
    .select('id, full_name, email, user_regions(region_id)')
    .eq('role_id', roleRow.id)
    .eq('is_active', true)
    .order('full_name');

  // If the admin has region restrictions, limit to those users
  if (allowedRegionIds.length > 0) {
    const { data: regionUsers } = await adminSupabase
      .from('user_regions').select('user_id').in('region_id', allowedRegionIds);
    const regionUserIds = [...new Set((regionUsers || []).map(r => r.user_id))];
    if (regionUserIds.length === 0) return res.status(200).json([]);
    usersQ = usersQ.in('id', regionUserIds);
  }

  // Optional: filter by a specific region passed from the client
  const regionIdParam = req.query?.region_id;
  if (regionIdParam) {
    const rid = parseInt(regionIdParam, 10);
    if (!isNaN(rid)) {
      const { data: regionUsers2, error: ruErr } = await adminSupabase
        .from('user_regions').select('user_id').eq('region_id', rid);
      if (ruErr) return res.status(500).json({ error: ruErr.message });
      const regionUserIds2 = [...new Set((regionUsers2 || []).map(r => r.user_id))];
      if (regionUserIds2.length === 0) return res.status(200).json([]);
      usersQ = usersQ.in('id', regionUserIds2);
    }
  }

  const { data: users, error } = await usersQ;

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json(users ?? []);
}

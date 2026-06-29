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
 * GET  /api/admin/targets?year=YYYY&month=M
 *   Returns all salespersons with their target (if set) for that month.
 *
 * POST /api/admin/targets
 *   Body: { user_id, year, month, cartons_target }
 *   Upserts the target for that user/year/month.
 */
export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  const { allowedRegionIds } = admin;

  // ── GET ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { year, month, region_id } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

    // region_id narrows the scope: if Manager has assigned regions, intersect with the requested
    // region so selecting "Mombasa" shows only Mombasa even when the manager covers multiple regions
    const effectiveRegionIds = allowedRegionIds.length > 0
      ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
      : region_id ? [parseInt(region_id)] : [];

    // Fetch salesperson role id
    const { data: roleRow } = await adminSupabase
      .from('roles')
      .select('id')
      .eq('name', 'Salesperson')
      .single();

    if (!roleRow) return res.status(200).json([]);

    // All active salespersons
    let usersQ = adminSupabase
      .from('app_users')
      .select('id, full_name, email')
      .eq('role_id', roleRow.id)
      .eq('is_active', true)
      .order('full_name');

    if (effectiveRegionIds.length > 0) {
      const { data: regionUsers } = await adminSupabase
        .from('user_regions').select('user_id').in('region_id', effectiveRegionIds);
      const regionUserIds = [...new Set((regionUsers || []).map(r => r.user_id))];
      if (regionUserIds.length === 0) return res.status(200).json([]);
      usersQ = usersQ.in('id', regionUserIds);
    }

    const { data: users, error: uErr } = await usersQ;

    if (uErr) return res.status(500).json({ error: uErr.message });

    // Existing targets for this month
    const userIds = (users || []).map(u => u.id);
    let targetsMap = {};
    if (userIds.length > 0) {
      const { data: tRows, error: tErr } = await adminSupabase
        .from('targets')
        .select('id, user_id, cartons_target')
        .in('user_id', userIds)
        .eq('year', parseInt(year))
        .eq('month', parseInt(month));

      if (tErr) return res.status(500).json({ error: tErr.message });
      (tRows || []).forEach(t => { targetsMap[t.user_id] = t; });
    }

    const result = (users || []).map(u => ({
      user_id:        u.id,
      full_name:      u.full_name || u.email,
      email:          u.email,
      target_id:      targetsMap[u.id]?.id || null,
      cartons_target: targetsMap[u.id]?.cartons_target ?? null,
    }));

    if (!region_id && result.length > 10) {
      res.setHeader('X-Data-Limited', 'true');
      return res.status(200).json(result.slice(0, 10));
    }
    return res.status(200).json(result);
  }

  // ── POST ───────────────────────────────────────────────────────────────
  if (req.method === 'POST') {    if (admin.role === 'Manager') return res.status(403).json({ error: 'Managers have read-only access to targets' });    const { user_id, year, month, cartons_target } = req.body;
    if (!user_id || !year || !month || cartons_target == null)
      return res.status(400).json({ error: 'user_id, year, month, cartons_target are required' });

    const val = parseInt(cartons_target);
    if (isNaN(val) || val < 0)
      return res.status(400).json({ error: 'cartons_target must be a non-negative number' });

    const { data, error } = await adminSupabase
      .from('targets')
      .upsert(
        { user_id, year: parseInt(year), month: parseInt(month), cartons_target: val },
        { onConflict: 'user_id,year,month' },
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

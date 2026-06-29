import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/sales/profile
 * Returns the authenticated salesperson's profile including their
 * single assigned region. Only accessible by Salesperson role.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // Verify token and get auth user
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Look up app_user by email, joining role
    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, full_name, vehicle, roles(name)')
      .eq('email', user.email)
      .single();

    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
    if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Access denied' });
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');

    // Fetch the single assigned region via user_regions
    const { data: regionRows, error: regionErr } = await adminSupabase
      .from('user_regions')
      .select('region_id, regions(id, name)')
      .eq('user_id', appUser.id)
      .limit(1);

    if (regionErr) return res.status(500).json({ error: regionErr.message });

    const assigned = regionRows?.[0]?.regions ?? null;

    return res.status(200).json({
      user_id:     appUser.id,
      full_name:   appUser.full_name,
      email:       user.email,
      vehicle:     appUser.vehicle,
      region_id:   assigned?.id   ?? null,
      region_name: assigned?.name ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/sales/meta
 * Returns profile + subregions + competitor_products in one round-trip.
 * Authenticates once, then resolves subregions and competitor products in parallel.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // 1. Verify token
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // 2. Look up app_user — join role and user_regions+regions in one query
    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, full_name, vehicle, roles(name), user_regions(region_id, regions(id, name))')
      .eq('email', user.email)
      .single();

    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
    if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Access denied' });
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');

    const assigned = appUser.user_regions?.[0]?.regions ?? null;
    const regionId = assigned?.id ?? null;

    // No region assigned — return empty collections instead of erroring
    if (!regionId) {
      return res.status(200).json({
        user_id:             appUser.id,
        full_name:           appUser.full_name,
        email:               user.email,
        vehicle:             appUser.vehicle,
        region_id:           null,
        region_name:         null,
        subregions:          [],
        competitor_products: [],
      });
    }

    // 3. Run subregions + competitor_products queries in parallel
    const [subResult, compResult] = await Promise.all([
      adminSupabase
        .from('subregions')
        .select('id, name')
        .eq('region_id', regionId)
        .order('name'),
      adminSupabase
        .from('competitor_products')
        .select('id, region_id, name, note, sort_order')
        .eq('region_id', regionId)
        .order('sort_order')
        .order('id'),
    ]);

    return res.status(200).json({
      user_id:             appUser.id,
      full_name:           appUser.full_name,
      email:               user.email,
      vehicle:             appUser.vehicle,
      region_id:           regionId,
      region_name:         assigned.name,
      subregions:          subResult.data  ?? [],
      competitor_products: compResult.data ?? [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

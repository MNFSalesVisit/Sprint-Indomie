import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/sales/subregions
 * Returns all subregions under the salesperson's assigned region.
 * Only accessible by Salesperson role.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // Verify token
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Look up app_user and confirm Salesperson role
    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, roles(name)')
      .eq('email', user.email)
      .single();

    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
    if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Access denied' });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

    // Get the single assigned region
    const { data: regionRows, error: regionErr } = await adminSupabase
      .from('user_regions')
      .select('region_id')
      .eq('user_id', appUser.id)
      .limit(1);

    if (regionErr) return res.status(500).json({ error: regionErr.message });

    const regionId = regionRows?.[0]?.region_id;
    if (!regionId) return res.status(200).json([]);

    // Return all subregions for that region, ordered alphabetically
    const { data: subregions, error: subErr } = await adminSupabase
      .from('subregions')
      .select('id, name')
      .eq('region_id', regionId)
      .order('name');

    if (subErr) return res.status(500).json({ error: subErr.message });

    return res.status(200).json(subregions ?? []);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

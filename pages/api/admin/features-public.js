import { adminSupabase } from '../../../lib/adminAuth';
import { getCache, setCache } from '../../../lib/serverCache';

/**
 * GET /api/admin/features-public
 * Returns a simple { key: enabled } map for all features.
 * No sensitive data — used by the Admin module on load to decide tab visibility.
 * Requires a valid Admin or Super Admin token (re-uses the check endpoint's approach).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  // Verify the token belongs to a valid Admin or Super Admin
  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('roles(name)')
    .eq('email', user.email)
    .single();

  const role = appUser?.roles?.name;
  if (role !== 'Admin' && role !== 'Super Admin' && role !== 'Manager') {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Serve from cache when available (5-minute TTL)
  const cached = getCache('features-public');
  if (cached) return res.status(200).json(cached);

  const { data, error } = await adminSupabase
    .from('features')
    .select('key, enabled');

  if (error) return res.status(500).json({ error: error.message });

  // Return as a plain boolean map: { map: true, customer: false, ... }
  const map = {};
  (data ?? []).forEach(f => { map[f.key] = f.enabled; });

  setCache('features-public', map, 5 * 60 * 1000); // 5-minute TTL
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).json(map);
}

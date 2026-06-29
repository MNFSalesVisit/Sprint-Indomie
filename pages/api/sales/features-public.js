import { adminSupabase } from '../../../lib/adminAuth';

/**
 * GET /api/sales/features-public
 * Returns a { key: enabled } boolean map for sales_* feature flags.
 * Used by the Salesperson module to decide tab visibility.
 * Requires a valid Salesperson (or Admin / Super Admin) token.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('roles(name)')
    .eq('email', user.email)
    .single();

  const role = appUser?.roles?.name;
  if (!role) return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await adminSupabase
    .from('features')
    .select('key, enabled')
    .like('key', 'sales_%');

  if (error) return res.status(500).json({ error: error.message });

  const map = {};
  (data ?? []).forEach(f => { map[f.key] = f.enabled; });

  res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  return res.status(200).json(map);
}

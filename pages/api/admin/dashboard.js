import { createClient } from '@supabase/supabase-js';
import { getCache, setCache } from '../../../lib/serverCache';
import { logApiCall } from '../../../lib/apiLogger';
import { applyLowPriorityThrottle } from '../../../lib/throttle';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  const { allowedRegionIds } = admin;

  // Cache key is scoped to the admin's region set so region-scoped admins get
  // their own cached counts (TTL: 60 s — dashboard stats don't need to be live).
  const cacheKey = `dashboard:${allowedRegionIds.sort().join(',') || 'all'}`;
  const cached = getCache(cacheKey);
  if (cached) return res.status(200).json(cached);

  logApiCall('/api/admin/dashboard', 'admin');
  // Month-to-date window
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const isoStart = start.toISOString();

  // Resolve allowed shop IDs for region-scoped admins
  let allowedShopIds = null;
  if (allowedRegionIds.length > 0) {
    const { data: shopRows } = await adminSupabase
      .from('shops').select('id').in('region_id', allowedRegionIds);
    allowedShopIds = (shopRows || []).map(s => s.id);
    if (allowedShopIds.length === 0)
      return res.status(200).json({ pending: 0, approved: 0, rejected: 0, total: 0 });
  }

  const statuses = ['pending', 'approved', 'rejected'];

  // Run all three count queries in parallel instead of sequentially.
  const results = await Promise.all(
    statuses.map(s => {
      let q = adminSupabase
        .from('uplifts')
        .select('id', { count: 'exact', head: true })
        .eq('status', s)
        .gte('created_at', isoStart);
      if (allowedShopIds) q = q.in('shop_id', allowedShopIds);
      return q;
    })
  );

  const counts = {};
  for (let i = 0; i < statuses.length; i++) {
    const { count, error } = results[i];
    if (error) return res.status(500).json({ error: error.message });
    counts[statuses[i]] = count ?? 0;
  }

  counts.total = counts.pending + counts.approved + counts.rejected;

  setCache(cacheKey, counts, 60 * 1000); // 60-second TTL
  res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
  return res.status(200).json(counts);
}

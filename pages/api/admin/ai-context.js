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

// Return aggregated, anonymized data suitable for external ML usage
export async function getAggregatedContext(allowedRegionIds = []) {
  // Window: last 30 days
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const isoSince = since.toISOString();

  // 1) shops in scope
  let shopQ = adminSupabase.from('shops').select('id,region_id');
  if (Array.isArray(allowedRegionIds) && allowedRegionIds.length > 0) shopQ = shopQ.in('region_id', allowedRegionIds);
  const { data: shopRows } = await shopQ;
  const total_shops = (shopRows || []).length;

  // Map region -> shop ids
  const regionMap = {};
  (shopRows || []).forEach(s => {
    const r = String(s.region_id || 'unknown');
    regionMap[r] = regionMap[r] || [];
    regionMap[r].push(s.id);
  });

  // 2) For each region compute success/total visits
  const top_regions = [];
  const low_performing_regions = [];

  for (const regionId of Object.keys(regionMap)) {
    const shopIds = regionMap[regionId];
    if (!shopIds.length) continue;
    // total visits
    const totQ = await adminSupabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .in('shop_id', shopIds)
      .gte('created_at', isoSince);
    const total = totQ.count || 0;
    // successful visits (visit_sold === 'yes')
    const okQ = await adminSupabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .in('shop_id', shopIds)
      .gte('created_at', isoSince)
      .eq('visit_sold', 'yes');
    const success = okQ.count || 0;
    const efficiency = total > 0 ? Math.round((success / total) * 100) : null;
    top_regions.push({ region: regionId, sales: success });
    if (efficiency != null && efficiency < 30) low_performing_regions.push({ region: regionId, efficiency });
  }

  // Sort top_regions by sales desc and keep top 5
  top_regions.sort((a, b) => b.sales - a.sales);
  const top_regions_slice = top_regions.slice(0, 5);

  // 3) Problem shops heuristic: shops with >50% failed visits in window
  let problem_shops = 0;
  for (const s of shopRows || []) {
    const tot = await adminSupabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', s.id)
      .gte('created_at', isoSince);
    const total = tot.count || 0;
    if (total === 0) continue;
    const failed = await adminSupabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', s.id)
      .gte('created_at', isoSince)
      .neq('visit_sold', 'yes');
    const failedCount = failed.count || 0;
    if (failedCount / total >= 0.5) problem_shops += 1;
  }

  // 4) common reasons (visit_sold === 'no')
  const reasonsRes = await adminSupabase
    .from('visits')
    .select('visit_reason')
    .gte('created_at', isoSince)
    .neq('visit_sold', 'yes');
  const reasonCounts = { financial: 0, stock: 0, other: 0 };
  (reasonsRes.data || []).forEach(r => {
    const rr = (r.visit_reason || '').toLowerCase();
    if (rr.includes('finance') || rr.includes('payment') || rr.includes('money')) reasonCounts.financial += 1;
    else if (rr.includes('stock') || rr.includes('no stock') || rr.includes('out of stock')) reasonCounts.stock += 1;
    else reasonCounts.other += 1;
  });

  return {
    total_shops,
    problem_shops,
    top_regions: top_regions_slice,
    low_performing_regions,
    common_reasons: reasonCounts,
    window_days: 30,
    generated_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  try {
    const aggregated = await getAggregatedContext(admin.allowedRegionIds || []);
    return res.status(200).json(aggregated);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to aggregate' });
  }
}

import { createClient } from '@supabase/supabase-js';
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

/**
 * GET /api/admin/sku-analysis
 *   ?year=YYYY&month=M
 *   [&dateFrom=YYYY-MM-DD] [&dateTo=YYYY-MM-DD]
 *   [&user_id=UUID]        [&subregion_id=N] [&region_id=N]
 *
 * Returns per-SKU carton sales breakdown.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  logApiCall('/api/admin/sku-analysis', 'admin');
  await applyLowPriorityThrottle();
  const { allowedRegionIds } = admin;

  const { year, month, dateFrom, dateTo, user_id, subregion_id, region_id } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

  const y = parseInt(year);
  const m = parseInt(month);

  const start = dateFrom
    ? new Date(dateFrom + 'T00:00:00').toISOString()
    : new Date(y, m - 1, 1).toISOString();
  const end = dateTo
    ? new Date(dateTo + 'T23:59:59.999').toISOString()
    : new Date(y, m, 1).toISOString();

  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];

  // ── 1. Paginate visits batch-by-batch (NO embedded join) ────────────────
  const skuAggr = {};
  const visitMap = {};
  const V_PAGE = 1000;
  let vPage = 0;

  while (true) {
    let visitsQ = adminSupabase
      .from('visits')
      .select('id, user_id, subregion_id')
      .eq('visit_type', 'sales')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })
      .range(vPage * V_PAGE, (vPage + 1) * V_PAGE - 1);

    if (user_id)      visitsQ = visitsQ.eq('user_id', user_id);
    if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id));
    if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);

    const { data: vChunk, error: vErr } = await visitsQ;
    if (vErr) return res.status(500).json({ error: vErr.message });
    if (!vChunk || vChunk.length === 0) break;

    vChunk.forEach(v => { visitMap[v.id] = v; });

    // ── 1b. Fetch ALL visit_items for this batch (paginated by result row) ─
    const batchVisitIds = vChunk.map(v => v.id);
    if (batchVisitIds.length > 0) {
      const I_PAGE = 1000;
      let iPage = 0;
      while (true) {
        const { data: iChunk, error: iErr } = await adminSupabase
          .from('visit_items')
          .select('visit_id, product_id, sold')
          .in('visit_id', batchVisitIds)
          .order('visit_id', { ascending: true })
          .range(iPage * I_PAGE, (iPage + 1) * I_PAGE - 1);
        if (iErr) return res.status(500).json({ error: iErr.message });
        if (!iChunk || iChunk.length === 0) break;

        iChunk.forEach(item => {
          const sold = typeof item.sold === 'number' ? item.sold : 0;
          if (sold <= 0) return;

          const visit = visitMap[item.visit_id];
          if (!visit) return;

          const pid = item.product_id;
          if (!skuAggr[pid]) {
            skuAggr[pid] = { total_sold: 0, visitSet: new Set(), by_user: {}, by_subregion: {} };
          }
          skuAggr[pid].total_sold += sold;
          skuAggr[pid].visitSet.add(visit.id);

          if (visit.user_id) {
            skuAggr[pid].by_user[visit.user_id] = (skuAggr[pid].by_user[visit.user_id] || 0) + sold;
          }
          if (visit.subregion_id) {
            skuAggr[pid].by_subregion[visit.subregion_id] = (skuAggr[pid].by_subregion[visit.subregion_id] || 0) + sold;
          }
        });

        if (iChunk.length < I_PAGE) break;
        iPage++;
      }
    }

    if (vChunk.length < V_PAGE) break;
    vPage++;
  }

  if (Object.keys(skuAggr).length === 0) return res.status(200).json([]);

  // ── 2. Fetch lookup tables only for IDs we actually need ────────────────
  const productIds   = Object.keys(skuAggr).map(Number);
  const userIds      = [...new Set(Object.values(skuAggr).flatMap(a => Object.keys(a.by_user)))];
  const subregionIds = [...new Set(Object.values(skuAggr).flatMap(a => Object.keys(a.by_subregion).map(Number)))];

  const [productsRes, usersRes, subregionsRes] = await Promise.all([
    productIds.length > 0
      ? adminSupabase.from('products').select('id, sku, name').in('id', productIds)
      : Promise.resolve({ data: [] }),
    userIds.length > 0
      ? adminSupabase.from('app_users').select('id, full_name, email').in('id', userIds)
      : Promise.resolve({ data: [] }),
    subregionIds.length > 0
      ? adminSupabase.from('subregions').select('id, name').in('id', subregionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const productMap = {};
  (productsRes.data || []).forEach(p => { productMap[p.id] = p; });
  const userMap = {};
  (usersRes.data || []).forEach(u => { userMap[u.id] = u.full_name || u.email; });
  const subregionMap = {};
  (subregionsRes.data || []).forEach(s => { subregionMap[s.id] = s.name; });

  // ── 3. Build result array ───────────────────────────────────────────────
  const result = Object.entries(skuAggr).map(([pid, agg]) => {
    const product = productMap[parseInt(pid)];
    return {
      product_id:     parseInt(pid),
      sku:            product?.sku  || `#${pid}`,
      name:           product?.name || 'Unknown',
      total_sold:     agg.total_sold,
      visits_count:   agg.visitSet.size,
      by_salesperson: Object.entries(agg.by_user)
        .map(([uid, sold]) => ({ user_id: uid, full_name: userMap[uid] || uid, sold }))
        .sort((a, b) => b.sold - a.sold),
      by_subregion: Object.entries(agg.by_subregion)
        .map(([sid, sold]) => ({ subregion_id: parseInt(sid), subregion_name: subregionMap[sid] || `Subregion ${sid}`, sold }))
        .sort((a, b) => b.sold - a.sold),
    };
  }).sort((a, b) => b.total_sold - a.total_sold);

  const hasFilters = !!(user_id || region_id || subregion_id || dateFrom || dateTo);
  if (!hasFilters && result.length > 10) {
    res.setHeader('X-Data-Limited', 'true');
    return res.status(200).json(result.slice(0, 10));
  }
  return res.status(200).json(result);
}
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
 *   [&user_id=UUID]        [&subregion_id=N]
 *
 * Returns per-SKU carton sales breakdown:
 * [{
 *   product_id, sku, name,
 *   total_sold,         — total cartons sold in window
 *   visits_count,       — distinct visits that had this SKU sold
 *   by_salesperson: [{ user_id, full_name, sold }],
 *   by_subregion:   [{ subregion_id, subregion_name, sold }],
 * }]
 * Sorted by total_sold desc.
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

  // Build date window — dateFrom/dateTo override month boundaries if provided
  const start = dateFrom
    ? new Date(dateFrom + 'T00:00:00').toISOString()
    : new Date(y, m - 1, 1).toISOString();
  const end = dateTo
    ? new Date(dateTo + 'T23:59:59.999').toISOString()
    : new Date(y, m, 1).toISOString();

  // ── 1. Fetch visits with their items in window ──────────────────────────
  let visitsQ = adminSupabase
    .from('visits')
    .select('id, user_id, subregion_id, visit_items(product_id, sold)')
    .eq('visit_type', 'sales')
    .gte('created_at', start)
    .lt('created_at', end);

  if (user_id)      visitsQ = visitsQ.eq('user_id', user_id);
  if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id));
  // region_id narrows the scope: if Manager has assigned regions, intersect with the requested
  // region so selecting "Mombasa" shows only Mombasa even when the manager covers multiple regions
  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];
  if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);

  const { data: visits, error: vErr } = await visitsQ;
  if (vErr) return res.status(500).json({ error: vErr.message });

  if (!visits || visits.length === 0) return res.status(200).json([]);

  // ── 2. Fetch all products for sku/name lookup ───────────────────────────
  const { data: products } = await adminSupabase
    .from('products')
    .select('id, sku, name');
  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p; });

  // ── 3. Fetch user names for the visits ─────────────────────────────────
  const userIds = [...new Set(visits.map(v => v.user_id).filter(Boolean))];
  const userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await adminSupabase
      .from('app_users')
      .select('id, full_name, email')
      .in('id', userIds);
    (users || []).forEach(u => { userMap[u.id] = u.full_name || u.email; });
  }

  // ── 4. Fetch subregion names for the visits ────────────────────────────
  const subregionIds = [...new Set(visits.map(v => v.subregion_id).filter(Boolean))];
  const subregionMap = {};
  if (subregionIds.length > 0) {
    const { data: subregions } = await adminSupabase
      .from('subregions')
      .select('id, name')
      .in('id', subregionIds);
    (subregions || []).forEach(s => { subregionMap[s.id] = s.name; });
  }

  // ── 5. Aggregate per SKU ────────────────────────────────────────────────
  // skuAggr: { product_id: { total_sold, visitSet, by_user, by_subregion } }
  const skuAggr = {};

  visits.forEach(visit => {
    (visit.visit_items || []).forEach(item => {
      if (!item.sold || item.sold <= 0) return;
      const pid = item.product_id;
      if (!skuAggr[pid]) {
        skuAggr[pid] = { total_sold: 0, visitSet: new Set(), by_user: {}, by_subregion: {} };
      }
      skuAggr[pid].total_sold += item.sold;
      skuAggr[pid].visitSet.add(visit.id);
      if (visit.user_id) {
        skuAggr[pid].by_user[visit.user_id] = (skuAggr[pid].by_user[visit.user_id] || 0) + item.sold;
      }
      if (visit.subregion_id) {
        skuAggr[pid].by_subregion[visit.subregion_id] = (skuAggr[pid].by_subregion[visit.subregion_id] || 0) + item.sold;
      }
    });
  });

  // ── 6. Build result array ───────────────────────────────────────────────
  const result = Object.entries(skuAggr).map(([pid, agg]) => {
    const product = productMap[parseInt(pid)];
    return {
      product_id:   parseInt(pid),
      sku:          product?.sku  || `#${pid}`,
      name:         product?.name || 'Unknown',
      total_sold:   agg.total_sold,
      visits_count: agg.visitSet.size,
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

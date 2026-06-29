import { createClient } from '@supabase/supabase-js';
import { logApiCall } from '../../../lib/apiLogger';
import { applyLowPriorityThrottle } from '../../../lib/throttle';
import { getCache, setCache } from '../../../lib/serverCache';

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
 * GET /api/admin/performance?year=YYYY&month=M[&user_id=UUID]
 *
 * Returns per-salesperson performance for the given month:
 * [{
 *   user_id, full_name, email,
 *   cartons_target,          — monthly target (null if not set)
 *   cartons_sold_mtd,        — total cartons sold in MTD window
 *   visits_total,            — total visits in period
 *   shops_sold,              — number of visits where at least 1 carton was sold (per-visit)
 *   shops_not_sold,          — number of visits where 0 cartons were sold (per-visit)
 *   performance_pct,         — cartons_sold_mtd / cartons_target * 100 (null if no target)
 * }]
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
  logApiCall('/api/admin/performance', 'admin');
  const { allowedRegionIds } = admin;

  const { year, month, user_id, dateFrom, dateTo, subregion_id, region_id } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month are required' });

  // ── Server-side cache (60 s TTL) — keyed by all filter params ────────────
  // Only cache unfiltered or region-only calls (those used by the dashboard).
  const cacheKey = `perf:${allowedRegionIds.sort().join(',')}:${year}:${month}:${region_id || ''}:${subregion_id || ''}:${user_id || ''}:${dateFrom || ''}:${dateTo || ''}`;
  const cached = getCache(cacheKey);
  if (cached) return res.status(200).json(cached);

  await applyLowPriorityThrottle();

  const y = parseInt(year);
  const m = parseInt(month);
  const _now  = new Date();
  const start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(y, m - 1, 1).toISOString();
  const end   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').toISOString()
              : dateFrom ? new Date(_now.getFullYear(), _now.getMonth(), _now.getDate() + 1).toISOString()
              : new Date(y, m, 1).toISOString();

  // region_id narrows the scope: if Manager has assigned regions, intersect with the requested
  // region so selecting "Mombasa" shows only Mombasa even when the manager covers multiple regions
  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];

  // ── 1. Fetch salesperson role id ──────────────────────────────────────
  const { data: roleRow } = await adminSupabase
    .from('roles').select('id').eq('name', 'Salesperson').single();
  if (!roleRow) return res.status(200).json([]);

  // ── 2. Fetch all active salespersons (or a single one) ────────────────
  let usersQ = adminSupabase
    .from('app_users')
    .select('id, full_name, email, avatar_url')
    .eq('role_id', roleRow.id)
    .eq('is_active', true)
    .order('full_name');

  // Apply region filter first, then narrow to a specific user_id if provided
  if (effectiveRegionIds.length > 0) {
    const { data: regionUsers } = await adminSupabase
      .from('user_regions').select('user_id').in('region_id', effectiveRegionIds);
    const regionUserIds = [...new Set((regionUsers || []).map(r => r.user_id))];
    if (regionUserIds.length === 0) return res.status(200).json([]);
    usersQ = usersQ.in('id', regionUserIds);
  }
  if (user_id) usersQ = usersQ.eq('id', user_id);

  const { data: users, error: uErr } = await usersQ;
  if (uErr) return res.status(500).json({ error: uErr.message });
  if (!users || users.length === 0) return res.status(200).json([]);

  const userIds = users.map(u => u.id);

  // ── 3. Fetch targets + shop region lookup in parallel ─────────────────
  const [targetsRes, shopRegionRes] = await Promise.all([
    adminSupabase
      .from('targets')
      .select('user_id, cartons_target')
      .in('user_id', userIds)
      .eq('year', y)
      .eq('month', m),
    effectiveRegionIds.length > 0
      ? adminSupabase.from('shops').select('id').in('region_id', effectiveRegionIds)
      : Promise.resolve({ data: null }),
  ]);

  const targetMap = {};
  (targetsRes.data || []).forEach(t => { targetMap[t.user_id] = t.cartons_target; });

  const allowedShopIds = shopRegionRes.data ? (shopRegionRes.data || []).map(s => s.id) : null;

  // ── 4. Fetch visits + visit_items in window (paginated) ────────────────
  const _PAGE = 1000;
  let _page   = 0;
  const visits = [];
  let vErr = null;
  while (true) {
    let visitsQ = adminSupabase
      .from('visits')
      .select('id, user_id, shop_id, visit_items ( sold )')
      .in('user_id', userIds)
      .eq('visit_type', 'sales')
      .gte('created_at', start)
      .lt('created_at', end)
      .range(_page * _PAGE, (_page + 1) * _PAGE - 1);
    if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id));
    if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);
    const { data: _rows, error: _err } = await visitsQ;
    if (_err) { vErr = _err; break; }
    if (!_rows || _rows.length === 0) break;
    visits.push(..._rows);
    if (_rows.length < _PAGE) break;
    _page++;
  }
  if (vErr) return res.status(500).json({ error: vErr.message });

  // ── 5. Fetch uplifts in window ─────────────────────────────────────────
  let upliftsQ = adminSupabase
    .from('uplifts')
    .select('id, user_id, shop_id')
    .in('user_id', userIds)
    .gte('created_at', start)
    .lt('created_at', end);
  if (allowedShopIds && allowedShopIds.length > 0) {
    upliftsQ = upliftsQ.in('shop_id', allowedShopIds);
  }
  const { data: uplifts } = await upliftsQ;
  const upliftCount = {};
  userIds.forEach(id => { upliftCount[id] = 0; });
  (uplifts || []).forEach(u => { if (upliftCount[u.user_id] !== undefined) upliftCount[u.user_id]++; });

  // ── 6. Aggregate per user ──────────────────────────────────────────────
  const aggr = {};
  userIds.forEach(id => {
    aggr[id] = {
      visits: 0,
      cartons_sold: 0,
      shops_sold: 0,
      shops_not_sold: 0,
    };
  });

  (visits || []).forEach(v => {
    if (!aggr[v.user_id]) return;
    aggr[v.user_id].visits++;
    const totalSold = (v.visit_items || []).reduce((s, i) => s + (i.sold || 0), 0);
    aggr[v.user_id].cartons_sold += totalSold;
    if (totalSold > 0) {
      aggr[v.user_id].shops_sold++;
    } else {
      aggr[v.user_id].shops_not_sold++;
    }
  });

  // ── 7. Build result ────────────────────────────────────────────────────
  const result = users.map(u => {
    const a      = aggr[u.id];
    const target = targetMap[u.id] ?? null;
    const pct    = target > 0 ? Math.round((a.cartons_sold / target) * 100) : null;
    return {
      user_id:          u.id,
      full_name:        u.full_name || u.email,
      email:            u.email,
      avatar_url:       u.avatar_url || null,
      cartons_target:   target,
      cartons_sold_mtd: a.cartons_sold,
      visits_total:     a.visits,
      uplift_count:     upliftCount[u.id] || 0,
      shops_sold:       a.shops_sold,
      shops_not_sold:   a.shops_not_sold,
      performance_pct:  pct,
    };
  });

  result.sort((a, b) => {
    if (a.performance_pct === null && b.performance_pct === null) return b.cartons_sold_mtd - a.cartons_sold_mtd;
    if (a.performance_pct === null) return 1;
    if (b.performance_pct === null) return -1;
    return b.performance_pct - a.performance_pct;
  });

  const hasFilters = !!(user_id || region_id || subregion_id || dateFrom || dateTo);
  let finalResult = result;
  if (!hasFilters && result.length > 10) {
    res.setHeader('X-Data-Limited', 'true');
    finalResult = result.slice(0, 10);
  }

  setCache(cacheKey, finalResult, 60 * 1000);
  return res.status(200).json(finalResult);
}

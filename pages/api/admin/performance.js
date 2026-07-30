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

  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];

  // ── 1. Fetch salesperson role id ──────────────────────────────────────
  const { data: roleRow } = await adminSupabase
    .from('roles').select('id').eq('name', 'Salesperson').single();
  if (!roleRow) return res.status(200).json([]);

  // ── 2. Fetch all active salespersons ─────────────────────────────────
  let usersQ = adminSupabase
    .from('app_users')
    .select('id, full_name, email, avatar_url')
    .eq('role_id', roleRow.id)
    .eq('is_active', true)
    .order('full_name');

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

  // ── 4. Fetch visits (paginated) ──────────────────────────────────────
  const VISIT_PAGE_SIZE = 1000;
  let visitPage = 0;
  let vErr = null;

  // Aggregation maps (pre-initialised so every user has a value)
  const userVisits = {};
  const userCartonsSold = {};
  const userShopsSold = {};
  const userShopsNotSold = {};
  userIds.forEach(id => {
    userVisits[id] = 0;
    userCartonsSold[id] = 0;
    userShopsSold[id] = 0;
    userShopsNotSold[id] = 0;
  });

  while (true) {
    let visitsQ = adminSupabase
      .from('visits')
      .select('id, user_id, shop_id')
      .in('user_id', userIds)
      .eq('visit_type', 'sales')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })
      .range(visitPage * VISIT_PAGE_SIZE, (visitPage + 1) * VISIT_PAGE_SIZE - 1);

    if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id));
    if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);

    const { data: visitBatch, error: visitErr } = await visitsQ;
    if (visitErr) { vErr = visitErr; break; }
    if (!visitBatch || visitBatch.length === 0) break;

    // ── 4b. Fetch ALL visit_items for this batch (paginated by result row) ─
    const batchVisitIds = visitBatch.map(v => v.id);
    const itemsByVisit = {};

    if (batchVisitIds.length > 0) {
      let itemOffset = 0;
      const ITEM_LIMIT = 1000;
      while (true) {
        const { data: itemBatch, error: itemErr } = await adminSupabase
          .from('visit_items')
          .select('visit_id, sold')
          .in('visit_id', batchVisitIds)
          .order('visit_id', { ascending: true })
          .range(itemOffset, itemOffset + ITEM_LIMIT - 1);

        if (itemErr) { vErr = itemErr; break; }
        if (!itemBatch || itemBatch.length === 0) break;

        itemBatch.forEach(item => {
          if (!itemsByVisit[item.visit_id]) itemsByVisit[item.visit_id] = [];
          itemsByVisit[item.visit_id].push(item);
        });

        if (itemBatch.length < ITEM_LIMIT) break;
        itemOffset += ITEM_LIMIT;
      }
    }
    if (vErr) break;

    // Aggregate this batch
    visitBatch.forEach(v => {
      const items = itemsByVisit[v.id] || [];
      const totalSold = items.reduce((s, i) => s + (i.sold || 0), 0);

      userVisits[v.user_id] += 1;
      userCartonsSold[v.user_id] += totalSold;
      if (totalSold > 0) userShopsSold[v.user_id] += 1;
      else               userShopsNotSold[v.user_id] += 1;
    });

    if (visitBatch.length < VISIT_PAGE_SIZE) break;
    visitPage++;
  }
  if (vErr) return res.status(500).json({ error: vErr.message });

  // ── 5. Fetch uplifts (paginated) ──────────────────────────────────────
  const upliftCount = {};
  userIds.forEach(id => { upliftCount[id] = 0; });

  let upPage = 0;
  const UP_PAGE = 1000;
  while (true) {
    let upliftsQ = adminSupabase
      .from('uplifts')
      .select('id, user_id, shop_id')
      .in('user_id', userIds)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })
      .range(upPage * UP_PAGE, (upPage + 1) * UP_PAGE - 1);

    if (allowedShopIds && allowedShopIds.length > 0) {
      upliftsQ = upliftsQ.in('shop_id', allowedShopIds);
    }

    const { data: upRows, error: upErr } = await upliftsQ;
    if (upErr) return res.status(500).json({ error: upErr.message });
    if (!upRows || upRows.length === 0) break;

    upRows.forEach(u => {
      if (upliftCount[u.user_id] !== undefined) upliftCount[u.user_id] += 1;
    });

    if (upRows.length < UP_PAGE) break;
    upPage++;
  }

  // ── 6. Build result ───────────────────────────────────────────────────
  const result = users.map(u => {
    const target = targetMap[u.id] ?? null;
    const sold   = userCartonsSold[u.id] || 0;
    const pct    = target > 0 ? Math.round((sold / target) * 100) : null;

    return {
      user_id:          u.id,
      full_name:        u.full_name || u.email || 'Unknown',
      email:            u.email || '',
      avatar_url:       u.avatar_url || null,
      cartons_target:   target,
      cartons_sold_mtd: sold,
      visits_total:     userVisits[u.id] || 0,
      uplift_count:     upliftCount[u.id] || 0,
      shops_sold:       userShopsSold[u.id] || 0,
      shops_not_sold:   userShopsNotSold[u.id] || 0,
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
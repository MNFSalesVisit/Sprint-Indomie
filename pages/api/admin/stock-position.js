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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, no-store');
  logApiCall('/api/admin/stock-position', 'admin');
  await applyLowPriorityThrottle();

  const { allowedRegionIds } = admin;
  const { region_id, subregion_id } = req.query;

  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];

  // ── 0. Resolve allowed shop IDs for region-filtered uplifts ─────────────
  let allowedShopIds = [];
  if (effectiveRegionIds.length > 0) {
    let sPage = 0;
    while (true) {
      const { data: sChunk, error: sErr } = await adminSupabase
        .from('shops')
        .select('id')
        .in('region_id', effectiveRegionIds)
        .range(sPage * 1000, (sPage + 1) * 1000 - 1);
      if (sErr) return res.status(500).json({ error: sErr.message });
      if (!sChunk || sChunk.length === 0) break;
      allowedShopIds.push(...sChunk.map(s => s.id));
      if (sChunk.length < 1000) break;
      sPage++;
    }
    if (allowedShopIds.length === 0) return res.status(200).json([]);
  }

  // Aggregation maps
  const upliftAggr = {}; // { user_id: { product_id: cartons } }
  const soldAggr   = {}; // { user_id: { product_id: sold } }

  // ── 1. Fetch approved uplifts (chunked by shop_id if region filtered) ──
  const SHOP_CHUNK = 500;
  const shopIdBatches = allowedShopIds.length > 0
    ? Array.from({ length: Math.ceil(allowedShopIds.length / SHOP_CHUNK) }, (_, i) =>
        allowedShopIds.slice(i * SHOP_CHUNK, (i + 1) * SHOP_CHUNK))
    : [null]; // null = no shop filter

  for (const shopChunk of shopIdBatches) {
    let upPage = 0;
    while (true) {
      let q = adminSupabase
        .from('uplifts')
        .select('id, user_id, shop_id, subregion_id')
        .eq('status', 'approved')
        .order('id', { ascending: true })
        .range(upPage * 1000, (upPage + 1) * 1000 - 1);

      if (shopChunk) q = q.in('shop_id', shopChunk);
      if (subregion_id) q = q.eq('subregion_id', parseInt(subregion_id));

      const { data: upChunk, error: upErr } = await q;
      if (upErr) return res.status(500).json({ error: upErr.message });
      if (!upChunk || upChunk.length === 0) break;

      // Fetch items for this exact batch of uplifts (paginated)
      const batchUpliftIds = upChunk.map(u => u.id);
      let uiPage = 0;
      while (true) {
        const { data: uiChunk, error: uiErr } = await adminSupabase
          .from('uplift_items')
          .select('uplift_id, product_id, cartons')
          .in('uplift_id', batchUpliftIds)
          .order('uplift_id', { ascending: true })
          .range(uiPage * 1000, (uiPage + 1) * 1000 - 1);
        if (uiErr) return res.status(500).json({ error: uiErr.message });
        if (!uiChunk || uiChunk.length === 0) break;

        uiChunk.forEach(item => {
          if (!item.product_id || !item.cartons) return;
          const uplift = upChunk.find(u => u.id === item.uplift_id);
          if (!uplift || !uplift.user_id) return;
          if (!upliftAggr[uplift.user_id]) upliftAggr[uplift.user_id] = {};
          upliftAggr[uplift.user_id][item.product_id] =
            (upliftAggr[uplift.user_id][item.product_id] || 0) + item.cartons;
        });

        if (uiChunk.length < 1000) break;
        uiPage++;
      }

      if (upChunk.length < 1000) break;
      upPage++;
    }
  }

  // ── 2. Fetch sales visits (paginated, direct region filter) ────────────
  let vPage = 0;
  while (true) {
    let q = adminSupabase
      .from('visits')
      .select('id, user_id, region_id, subregion_id')
      .eq('visit_type', 'sales')
      .order('id', { ascending: true })
      .range(vPage * 1000, (vPage + 1) * 1000 - 1);

    if (effectiveRegionIds.length > 0) q = q.in('region_id', effectiveRegionIds);
    if (subregion_id) q = q.eq('subregion_id', parseInt(subregion_id));

    const { data: vChunk, error: vErr } = await q;
    if (vErr) return res.status(500).json({ error: vErr.message });
    if (!vChunk || vChunk.length === 0) break;

    // Fetch items for this exact batch of visits (paginated)
    const batchVisitIds = vChunk.map(v => v.id);
    let viPage = 0;
    while (true) {
      const { data: viChunk, error: viErr } = await adminSupabase
        .from('visit_items')
        .select('visit_id, product_id, sold')
        .in('visit_id', batchVisitIds)
        .order('visit_id', { ascending: true })
        .range(viPage * 1000, (viPage + 1) * 1000 - 1);
      if (viErr) return res.status(500).json({ error: viErr.message });
      if (!viChunk || viChunk.length === 0) break;

      viChunk.forEach(item => {
        const sold = typeof item.sold === 'number' ? item.sold : 0;
        if (sold <= 0 || !item.product_id) return;
        const visit = vChunk.find(v => v.id === item.visit_id);
        if (!visit || !visit.user_id) return;
        if (!soldAggr[visit.user_id]) soldAggr[visit.user_id] = {};
        soldAggr[visit.user_id][item.product_id] =
          (soldAggr[visit.user_id][item.product_id] || 0) + sold;
      });

      if (viChunk.length < 1000) break;
      viPage++;
    }

    if (vChunk.length < 1000) break;
    vPage++;
  }

  // ── 3. Fetch products ───────────────────────────────────────────────────
  const { data: products } = await adminSupabase
    .from('products')
    .select('id, sku, name, sort_order')
    .eq('is_active', true)
    .order('sort_order')
    .order('id');
  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p; });

  // ── 4. Gather user IDs and fetch salesperson names ─────────────────────
  const userIds = [...new Set([
    ...Object.keys(upliftAggr),
    ...Object.keys(soldAggr),
  ].filter(Boolean))];

  if (userIds.length === 0) return res.status(200).json([]);

  const userMap = {};
  const USER_CHUNK = 100;
  for (let i = 0; i < userIds.length; i += USER_CHUNK) {
    const chunk = userIds.slice(i, i + USER_CHUNK);
    const { data: appUsers } = await adminSupabase
      .from('app_users')
      .select('id, full_name, email, roles(name)')
      .in('id', chunk);
    (appUsers || []).forEach(u => {
      if (u.roles?.name === 'Salesperson') {
        userMap[u.id] = u.full_name || u.email;
      }
    });
  }

  // ── 5. Fetch live stock balances (chunked by user) ─────────────────────
  const stockBalMap = {};
  const salespersonIds = Object.keys(userMap);
  if (salespersonIds.length > 0) {
    for (let i = 0; i < salespersonIds.length; i += USER_CHUNK) {
      const chunk = salespersonIds.slice(i, i + USER_CHUNK);
      let sbPage = 0;
      while (true) {
        const { data: sbChunk, error: sbErr } = await adminSupabase
          .from('stock_balances')
          .select('user_id, product_id, quantity')
          .in('user_id', chunk)
          .order('user_id', { ascending: true })
          .range(sbPage * 1000, (sbPage + 1) * 1000 - 1);
        if (sbErr) return res.status(500).json({ error: sbErr.message });
        if (!sbChunk || sbChunk.length === 0) break;

        for (const sb of sbChunk) {
          if (!stockBalMap[sb.user_id]) stockBalMap[sb.user_id] = {};
          stockBalMap[sb.user_id][sb.product_id] = sb.quantity ?? 0;
        }
        if (sbChunk.length < 1000) break;
        sbPage++;
      }
    }
  }

  // ── 6. Build result ─────────────────────────────────────────────────────
  const result = Object.keys(userMap)
    .map(uid => {
      const uplifted  = upliftAggr[uid] || {};
      const sold      = soldAggr[uid]   || {};
      const stockBals = stockBalMap[uid] || {};

      const productIds = [...new Set([
        ...Object.keys(uplifted).map(Number),
        ...Object.keys(sold).map(Number),
        ...Object.keys(stockBals).map(Number),
      ])];

      const skus = productIds
        .map(pid => {
          const p = productMap[pid];
          const u = uplifted[pid] || 0;
          const s = sold[pid]     || 0;
          const balVal = stockBals[pid] !== undefined ? stockBals[pid] : (u - s);
          const m = balVal - (u - s);
          return {
            product_id:     pid,
            sku:            p?.sku  || `#${pid}`,
            name:           p?.name || 'Unknown',
            sort_order:     p?.sort_order ?? 9999,
            uplifted:       u,
            manually_added: m,
            sold:           s,
            balance:        balVal,
          };
        })
        .sort((a, b) => a.sort_order - b.sort_order || a.sku.localeCompare(b.sku))
        .filter(x => x.uplifted !== 0 || x.manually_added !== 0 || x.sold !== 0 || x.balance !== 0);

      return {
        user_id:              uid,
        full_name:            userMap[uid],
        skus,
        total_uplifted:       skus.reduce((s, x) => s + x.uplifted, 0),
        total_manually_added: skus.reduce((s, x) => s + x.manually_added, 0),
        total_sold:           skus.reduce((s, x) => s + x.sold, 0),
        total_balance:        skus.reduce((s, x) => s + x.balance, 0),
      };
    })
    .filter(u => u.skus.length > 0)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const hasFilters = !!(region_id || subregion_id);
  if (!hasFilters && result.length > 10) {
    res.setHeader('X-Data-Limited', 'true');
    return res.status(200).json(result.slice(0, 10));
  }
  return res.status(200).json(result);
}
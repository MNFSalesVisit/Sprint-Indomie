import { createClient } from '@supabase/supabase-js';
import { logApiCall } from '../../../lib/apiLogger';

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

  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  logApiCall('/api/admin/map-data', 'admin');

  const { allowedRegionIds } = admin;
  const { year, month, region_id, subregion_id, user_id, date_from, date_to, show_all } = req.query;

  // Date window
  let start, end;
  if (date_from || date_to) {
    start = date_from ? new Date(date_from) : new Date(2000, 0, 1);
    end   = date_to   ? new Date(new Date(date_to).getTime() + 86400000) : new Date(Date.now() + 86400000);
  } else {
    const y = parseInt(year)  || new Date().getFullYear();
    const m = parseInt(month) || (new Date().getMonth() + 1);
    start = new Date(y, m - 1, 1);
    end   = new Date(y, m, 1);
  }

  const startIso = start.toISOString();
  const endIso   = end.toISOString();

  const effectiveVisitRegions = allowedRegionIds.length > 0
    ? (region_id ? [parseInt(region_id)].filter(id => allowedRegionIds.includes(id)) : allowedRegionIds)
    : (region_id ? [parseInt(region_id)] : []);

  // ── 1. Fetch ALL visits in period (NO coordinate filter) ───────────────
  const visits = [];
  let vPage = 0;
  const V_PAGE = 1000;

  while (true) {
    let visitsQuery = adminSupabase
      .from('visits')
      .select('id, visit_type, latitude, longitude, selfie_path, created_at, shop_id, user_id')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: false })
      .range(vPage * V_PAGE, (vPage + 1) * V_PAGE - 1);

    if (effectiveVisitRegions.length > 0) visitsQuery = visitsQuery.in('region_id', effectiveVisitRegions);
    if (subregion_id) visitsQuery = visitsQuery.eq('subregion_id', parseInt(subregion_id));
    if (user_id)      visitsQuery = visitsQuery.eq('user_id', user_id);

    const { data: vChunk, error: vErr } = await visitsQuery;
    if (vErr) return res.status(500).json({ error: vErr.message });
    if (!vChunk || vChunk.length === 0) break;

    visits.push(...vChunk);
    if (vChunk.length < V_PAGE) break;
    vPage++;
  }

  // ── 2. Pre-resolve valid shop IDs for uplift filtering ─────────────────
  let validUpliftShopIds = null;
  let skipUplifts = false;

  const shopFilterRegions = allowedRegionIds.length > 0
    ? (region_id ? [parseInt(region_id)].filter(id => allowedRegionIds.includes(id)) : allowedRegionIds)
    : (region_id ? [parseInt(region_id)] : []);
  const needsShopFilter = shopFilterRegions.length > 0 || subregion_id;

  if (needsShopFilter) {
    let shopQ = adminSupabase
      .from('shops')
      .select('id, latitude, longitude, region_id, subregion_id')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (shopFilterRegions.length > 0) shopQ = shopQ.in('region_id', shopFilterRegions);
    if (subregion_id) shopQ = shopQ.eq('subregion_id', parseInt(subregion_id));

    const { data: filteredShops } = await shopQ;
    validUpliftShopIds = new Set((filteredShops || []).map(s => s.id));
    if (validUpliftShopIds.size === 0) skipUplifts = true;
  }

  // ── 3. Fetch uplifts in period (paginated) ─────────────────────────────
  const uplifts = [];
  if (!skipUplifts) {
    let uPage = 0;
    const U_PAGE = 1000;

    while (true) {
      let upliftsQuery = adminSupabase
        .from('uplifts')
        .select('id, cartons, status, rejected_reason, created_at, shop_id, user_id')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: false })
        .range(uPage * U_PAGE, (uPage + 1) * U_PAGE - 1);

      if (user_id) upliftsQuery = upliftsQuery.eq('user_id', user_id);
      if (validUpliftShopIds) {
        upliftsQuery = upliftsQuery.in('shop_id', Array.from(validUpliftShopIds));
      }

      const { data: uChunk, error: uErr } = await upliftsQuery;
      if (uErr) return res.status(500).json({ error: uErr.message });
      if (!uChunk || uChunk.length === 0) break;

      uplifts.push(...uChunk);
      if (uChunk.length < U_PAGE) break;
      uPage++;
    }
  }

  // ── 4. Batch-fetch shops & users ───────────────────────────────────────
  const shopIds = new Set();
  const userIds = new Set();

  visits.forEach(v => { if (v.shop_id) shopIds.add(v.shop_id); if (v.user_id) userIds.add(v.user_id); });
  uplifts.forEach(u => { if (u.shop_id) shopIds.add(u.shop_id); if (u.user_id) userIds.add(u.user_id); });

  const shopIdsArr = Array.from(shopIds);
  const userIdsArr = Array.from(userIds);

  const [shopsRes, usersRes] = await Promise.all([
    shopIdsArr.length > 0
      ? adminSupabase.from('shops').select('id, name, location, latitude, longitude, region_id, subregion_id').in('id', shopIdsArr)
      : Promise.resolve({ data: [] }),
    userIdsArr.length > 0
      ? adminSupabase.from('app_users').select('id, full_name').in('id', userIdsArr)
      : Promise.resolve({ data: [] }),
  ]);

  const shopMap = {};
  (shopsRes.data || []).forEach(s => { shopMap[s.id] = s; });
  const userMap = {};
  (usersRes.data || []).forEach(u => { userMap[u.id] = u; });

  // ── 5. Batch-fetch visit_items & uplift_items (paginated) ──────────────
  const visitIds  = visits.map(v => v.id);
  const upliftIds = uplifts.map(u => u.id);

  const visitItems = [];
  if (visitIds.length > 0) {
    let viPage = 0;
    const VI_PAGE = 1000;
    while (true) {
      const { data: viChunk, error: viErr } = await adminSupabase
        .from('visit_items')
        .select('visit_id, sold, stock_position, not_sold_reason, product_id')
        .in('visit_id', visitIds)
        .order('visit_id', { ascending: true })
        .range(viPage * VI_PAGE, (viPage + 1) * VI_PAGE - 1);
      if (viErr) return res.status(500).json({ error: viErr.message });
      if (!viChunk || viChunk.length === 0) break;
      visitItems.push(...viChunk);
      if (viChunk.length < VI_PAGE) break;
      viPage++;
    }
  }

  const upliftItems = [];
  if (upliftIds.length > 0) {
    let uiPage = 0;
    const UI_PAGE = 1000;
    while (true) {
      const { data: uiChunk, error: uiErr } = await adminSupabase
        .from('uplift_items')
        .select('uplift_id, cartons, product_id')
        .in('uplift_id', upliftIds)
        .order('uplift_id', { ascending: true })
        .range(uiPage * UI_PAGE, (uiPage + 1) * UI_PAGE - 1);
      if (uiErr) return res.status(500).json({ error: uiErr.message });
      if (!uiChunk || uiChunk.length === 0) break;
      upliftItems.push(...uiChunk);
      if (uiChunk.length < UI_PAGE) break;
      uiPage++;
    }
  }

  // ── 6. Batch-fetch products ────────────────────────────────────────────
  const productIds = new Set();
  visitItems.forEach(i => { if (i.product_id) productIds.add(i.product_id); });
  upliftItems.forEach(i => { if (i.product_id) productIds.add(i.product_id); });

  const productIdsArr = Array.from(productIds);
  const productsRes = productIdsArr.length > 0
    ? await adminSupabase.from('products').select('id, sku, name').in('id', productIdsArr)
    : { data: [] };

  const productMap = {};
  (productsRes.data || []).forEach(p => { productMap[p.id] = p; });

  // ── 7. Build item lookup maps ──────────────────────────────────────────
  const visitItemsByVisit = {};
  visitItems.forEach(item => {
    if (!visitItemsByVisit[item.visit_id]) visitItemsByVisit[item.visit_id] = [];
    visitItemsByVisit[item.visit_id].push({
      sold: item.sold,
      stock_position: item.stock_position,
      not_sold_reason: item.not_sold_reason,
      products: item.product_id ? (productMap[item.product_id] || null) : null,
    });
  });

  const upliftItemsByUplift = {};
  upliftItems.forEach(item => {
    if (!upliftItemsByUplift[item.uplift_id]) upliftItemsByUplift[item.uplift_id] = [];
    upliftItemsByUplift[item.uplift_id].push({
      cartons: item.cartons,
      products: item.product_id ? (productMap[item.product_id] || null) : null,
    });
  });

  // ── 8. Build markers ───────────────────────────────────────────────────
  const markers = [];

  for (const v of visits) {
    const shop = v.shop_id ? shopMap[v.shop_id] : null;

    // Use visit GPS if available, otherwise fall back to shop's coordinates
    const lat = v.latitude ?? shop?.latitude;
    const lng = v.longitude ?? shop?.longitude;
    if (!lat || !lng) continue;

    // Only filter by shop region when we actually have shop data
    if (region_id    && shop && shop.region_id    !== parseInt(region_id))    continue;
    if (subregion_id && shop && shop.subregion_id !== parseInt(subregion_id)) continue;

    const items = visitItemsByVisit[v.id] || [];
    const totalSold = items.reduce((s, i) => s + (i.sold || 0), 0);
    const anyReason = items.find(i => i.not_sold_reason);
    const type = totalSold > 0 ? 'sold' : 'not_sold';

    const skus = items.map(i => ({
      sku:              i.products?.sku || '—',
      name:             i.products?.name || '—',
      sold:             i.sold || 0,
      stock_position:   i.stock_position || 0,
      not_sold_reason:  i.not_sold_reason || null,
      cartons_uplifted: 0,
    }));

    markers.push({
      id:               `visit-${v.id}`,
      shop_id:          v.shop_id || null,
      shop_name:        shop?.name || 'Unknown Shop',
      shop_location:    shop?.location || null,
      latitude:         lat,
      longitude:        lng,
      type,
      salesperson_name: userMap[v.user_id]?.full_name || 'Unknown',
      selfie_path:      v.selfie_path,
      selfie_url:       null,
      skus,
      total_sold:       totalSold,
      total_uplifted:   0,
      not_sold_reason:  anyReason?.not_sold_reason || null,
      visited_at:       v.created_at,
    });
  }

  for (const u of uplifts) {
    const shop = shopMap[u.shop_id];
    if (!shop) continue;

    const lat = shop.latitude;
    const lng = shop.longitude;
    if (!lat || !lng) continue;
    if (region_id && shop.region_id !== parseInt(region_id)) continue;
    if (subregion_id && shop.subregion_id !== parseInt(subregion_id)) continue;

    const items = upliftItemsByUplift[u.id] || [];
    const totalUplifted = items.reduce((s, i) => s + (i.cartons || 0), 0);
    const skus = items.map(i => ({
      sku:              i.products?.sku || '—',
      name:             i.products?.name || '—',
      sold:             0,
      stock_position:   0,
      not_sold_reason:  null,
      cartons_uplifted: i.cartons || 0,
    }));

    markers.push({
      id:               `uplift-${u.id}`,
      shop_id:          shop.id || null,
      shop_name:        shop.name || 'Unknown Shop',
      shop_location:    shop.location || null,
      latitude:         lat,
      longitude:        lng,
      type:             'uplift',
      salesperson_name: userMap[u.user_id]?.full_name || 'Unknown',
      selfie_path:      null,
      selfie_url:       null,
      skus,
      total_sold:       0,
      total_uplifted:   totalUplifted,
      not_sold_reason:  null,
      rejected_reason:  u.rejected_reason || null,
      visited_at:       u.created_at,
      uplift_status:    u.status,
    });
  }

  // ── 9. Unvisited shops (show_all) ──────────────────────────────────────
  if (show_all === '1') {
    // Build visited set from RAW visit/uplift rows (not markers) so a shop
    // is never wrongly marked unvisited just because a marker was skipped
    const visitedShopIds = new Set();
    visits.forEach(v => { if (v.shop_id) visitedShopIds.add(v.shop_id); });
    uplifts.forEach(u => { if (u.shop_id) visitedShopIds.add(u.shop_id); });

    const allShops = [];
    let sPage = 0;
    const S_PAGE = 1000;

    while (true) {
      let shopsQuery = adminSupabase
        .from('shops')
        .select('id, name, location, latitude, longitude, region_id, subregion_id')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .range(sPage * S_PAGE, (sPage + 1) * S_PAGE - 1);

      if (effectiveVisitRegions.length > 0) {
        shopsQuery = shopsQuery.in('region_id', effectiveVisitRegions);
      } else if (region_id) {
        shopsQuery = shopsQuery.eq('region_id', parseInt(region_id));
      }
      if (subregion_id) {
        shopsQuery = shopsQuery.eq('subregion_id', parseInt(subregion_id));
      }

      const { data: chunk, error: shopsErr } = await shopsQuery;
      if (shopsErr) return res.status(500).json({ error: shopsErr.message });
      if (!chunk || chunk.length === 0) break;

      allShops.push(...chunk);
      if (chunk.length < S_PAGE) break;
      sPage++;
    }

    for (const shop of allShops) {
      if (visitedShopIds.has(shop.id)) continue;
      markers.push({
        id:            `unvisited-${shop.id}`,
        shop_id:       shop.id,
        shop_name:     shop.name || 'Unknown Shop',
        shop_location: shop.location || null,
        latitude:      shop.latitude,
        longitude:     shop.longitude,
        type:          'unvisited',
      });
    }
  }

  return res.status(200).json(markers);
}
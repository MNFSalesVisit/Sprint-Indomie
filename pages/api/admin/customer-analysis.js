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
 * GET /api/admin/customer-analysis
 *   ?year=YYYY&month=M
 *   [&dateFrom=YYYY-MM-DD] [&dateTo=YYYY-MM-DD]
 *   [&subregion_id=N]      [&shop_id=N]
 *   [&mode=sales|uplifts]  (default: sales)
 *
 * SALES mode — returns per-shop sales stats:
 * [{
 *   shop_id, shop_name, shop_location, subregion_name, region_name,
 *   total_visits,          — total sales visits in window
 *   total_sold,            — total cartons sold across all SKUs
 *   total_not_sold_visits, — visits where nothing was sold
 *   last_visit_date,
 *   top_sku,               — SKU with highest sold qty
 *   by_sku: [{ sku, name, sold }],
 *   trend: [{ date, sold }],  — daily sold totals
 * }]
 *
 * UPLIFTS mode — returns per-shop uplift stats:
 * [{
 *   shop_id, shop_name, shop_location, subregion_name, region_name,
 *   total_uplifts,         — number of uplift requests
 *   approved_uplifts,
 *   rejected_uplifts,
 *   pending_uplifts,
 *   total_cartons_uplifted,
 *   last_uplift_date,
 *   by_sku: [{ sku, name, cartons }],
 *   trend: [{ date, cartons }],
 * }]
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  logApiCall('/api/admin/customer-analysis', 'admin');
  await applyLowPriorityThrottle();
  const { allowedRegionIds } = admin;


  const { year, month, dateFrom, dateTo, subregion_id, shop_id, region_id, user_id, mode = 'sales' } = req.query;
  // region_id narrows the scope: if Manager has assigned regions, intersect with the requested
  // region so selecting "Mombasa" shows only Mombasa even when the manager covers multiple regions
  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];
  let start, end;
  if (mode !== 'stock') {
    if (!dateFrom && (!year || !month)) return res.status(400).json({ error: 'year and month are required' });
    const y = year ? parseInt(year) : new Date().getFullYear();
    const m = month ? parseInt(month) : new Date().getMonth() + 1;
    start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(y, m - 1, 1).toISOString();
    end   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').toISOString() : new Date(y, m, 1).toISOString();
  }

  // ── Fetch products for SKU lookup ────────────────────────────────────
  const { data: products, error: prodErr } = await adminSupabase
    .from('products').select('id, sku, name');
  if (prodErr) {
    console.error('Failed to fetch products:', prodErr.message);
    return res.status(500).json({ error: 'Failed to fetch products: ' + prodErr.message });
  }
  if (!products) {
    console.error('No products returned from Supabase');
    return res.status(500).json({ error: 'No products returned from Supabase' });
  }
  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });

  // ── Fetch subregion/region names ─────────────────────────────────────
  const { data: subregionRows } = await adminSupabase.from('subregions').select('id, name, region_id');
  const { data: regionRows }    = await adminSupabase.from('regions').select('id, name');
  const subregionMap = {};
  (subregionRows || []).forEach(s => { subregionMap[s.id] = s; });
  const regionMap = {};
  (regionRows || []).forEach(r => { regionMap[r.id] = r.name; });

  // ── Fetch shops ───────────────────────────────────────────────────────
  let shopsQ = adminSupabase
    .from('shops')
    .select('id, name, location, subregion_id, region_id')
    .order('name');
  if (subregion_id) shopsQ = shopsQ.eq('subregion_id', parseInt(subregion_id));
  if (shop_id)      shopsQ = shopsQ.eq('id', parseInt(shop_id));
  if (effectiveRegionIds.length > 0) shopsQ = shopsQ.in('region_id', effectiveRegionIds);
  const { data: shops } = await shopsQ;
  if (!shops || shops.length === 0) return res.status(200).json([]);
  const shopIds  = shops.map(s => s.id);
  const shopMap  = {};
  shops.forEach(s => { shopMap[s.id] = s; });

  // ── MODE: STOCK POSITIONS ─────────────────────────────────────────────
  // Returns latest stock_position per shop per SKU (no date restriction).
  // Uses two separate queries (visits then visit_items) to avoid Supabase
  // schema-cache issues with nested relationship selects.
  if (mode === 'stock') {
    const PAGE = 1000;

    // Step 1: fetch all sales visits for these shops (newest first)
    let visitRows = [];
    let offset = 0;
    while (true) {
      const { data, error } = await adminSupabase
        .from('visits')
        .select('id, shop_id, created_at')
        .in('shop_id', shopIds)
        .eq('visit_type', 'sales')
        .order('id', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) { console.error('stock visits fetch error:', error.message); break; }
      if (!data || data.length === 0) break;
      visitRows.push(...data);
      if (data.length < PAGE) break;
      offset += PAGE;
      if (visitRows.length >= 50000) break;
    }

    // Step 2: fetch visit_items for those visits (separate query — no nested select)
    let allItems = [];
    let visitIds = visitRows.map(v => v.id);
    const ITEM_PAGE = 2000;
    for (let i = 0; i < visitIds.length; i += ITEM_PAGE) {
      const chunk = visitIds.slice(i, i + ITEM_PAGE);
      const { data: items, error: itemErr } = await adminSupabase
        .from('visit_items')
        .select('visit_id, product_id, stock_position')
        .in('visit_id', chunk);
      if (itemErr) { console.error('visit_items fetch error:', itemErr.message); continue; }
      if (items) allItems.push(...items);
    }

    // Also fetch recent uplifts and their stock_after values (these may reflect shop stock updates)
    let upliftRows = [];
    try {
      const { data: urows, error: uErr } = await adminSupabase
        .from('uplifts')
        .select('id, shop_id, created_at')
        .in('shop_id', shopIds)
        .order('id', { ascending: false });
      if (uErr) console.error('uplifts fetch error:', uErr.message);
      else upliftRows = urows || [];
    } catch (e) {
      console.error('uplifts fetch failed:', e.message || e);
    }

    let upliftItems = [];
    try {
      const upliftIds = upliftRows.map(u => u.id);
      for (let i = 0; i < upliftIds.length; i += ITEM_PAGE) {
        const chunk = upliftIds.slice(i, i + ITEM_PAGE);
        const { data: items, error: itemErr } = await adminSupabase
          .from('uplift_items')
          .select('uplift_id, product_id, stock_after')
          .in('uplift_id', chunk);
        if (itemErr) { console.error('uplift_items fetch error:', itemErr.message); continue; }
        if (items) upliftItems.push(...items);
      }
    } catch (e) {
      console.error('uplift_items fetch failed:', e.message || e);
    }

    // Build a map: visit_id -> { shop_id, created_at }
    const visitMeta = {};
    for (const v of visitRows) visitMeta[v.id] = { shop_id: v.shop_id, created_at: v.created_at };
    const upliftMeta = {};
    for (const u of upliftRows) upliftMeta[u.id] = { shop_id: u.shop_id, created_at: u.created_at };

    // For each shop+product keep only the most recent stock_position or stock_after
    // We'll combine visit items and uplift items and select the newest by created_at
    const latestMap = {}; // shop_id -> { product_id -> { stock_position, visit_date } }

    function assignIfNewer(shop_id, product_id, value, dateStr) {
      if (!latestMap[shop_id]) latestMap[shop_id] = {};
      const prev = latestMap[shop_id][product_id];
      if (!prev || (dateStr && prev.visit_date && dateStr > prev.visit_date) || !prev.visit_date) {
        latestMap[shop_id][product_id] = { stock_position: value ?? 0, visit_date: dateStr || null };
      }
    }

    // Process visit items
    for (const item of allItems) {
      const meta = visitMeta[item.visit_id];
      if (!meta) continue;
      assignIfNewer(meta.shop_id, item.product_id, item.stock_position ?? 0, meta.created_at);
    }

    // Process uplift items (stock_after)
    for (const item of upliftItems) {
      const meta = upliftMeta[item.uplift_id];
      if (!meta) continue;
      assignIfNewer(meta.shop_id, item.product_id, item.stock_after ?? 0, meta.created_at);
    }

    const result = shops
      .map(s => {
        const byProduct = latestMap[s.id] || {};
        const allSkus = Object.entries(byProduct)
          .map(([pidStr, info]) => {
            const pid = parseInt(pidStr);
            return {
              sku:            productMap[pid]?.sku  || '?',
              name:           productMap[pid]?.name || 'Unknown',
              stock_position: info.stock_position,
              visit_date:     info.visit_date ? info.visit_date.slice(0, 10) : null,
            };
          })
          .sort((a, b) => a.sku.localeCompare(b.sku));

        // Only include SKUs with stock_position > 0 in the SKU column / exports
        const skus = allSkus.filter(sku => (sku.stock_position || 0) > 0);

        // Include shops even if all stock positions are zero —
        // determine last recorded date from all SKUs, visits or uplifts if needed
        const lastVisitFromSkus = allSkus.reduce((max, sv) => (!max || (sv.visit_date && sv.visit_date > max) ? sv.visit_date : max), null);
        function getLastDateForShop(shopId) {
          let last = lastVisitFromSkus || null;
          for (const v of visitRows) { if (v.shop_id === shopId && (!last || v.created_at > last)) last = v.created_at; }
          for (const u of upliftRows) { if (u.shop_id === shopId && (!last || u.created_at > last)) last = u.created_at; }
          return last ? (typeof last === 'string' ? last.slice(0,10) : new Date(last).toISOString().slice(0,10)) : null;
        }

        const lastVisit = getLastDateForShop(s.id);
        const sr = subregionMap[s.subregion_id];
        return {
          shop_id:         s.id,
          shop_name:       s.name,
          shop_location:   s.location || '',
          subregion_name:  sr?.name || '—',
          region_name:     regionMap[sr?.region_id] || '—',
          last_visit_date: lastVisit,
          skus,
        };
      })
      .sort((a, b) => a.shop_name.localeCompare(b.shop_name));

    // Always return debug info envelope
    return res.status(200).json({
      _debug: {
        shops: shopIds.length,
        visits: visitRows.length,
        items: allItems.length,
        mapped: result.length
      },
      data: result
    });
  }

  // ── MODE: SALES ───────────────────────────────────────────────────────
  if (mode === 'sales') {
    // Fetch all visits paginated (bypasses Supabase max_rows cap) +
    // all-time stats in parallel on the first round-trip.
    const PAGE = 1000;
    const visits = [];
    let vErr = null;
    let offset = 0;
    let firstPageQ = adminSupabase
      .from('visits')
      .select('id, shop_id, created_at')
      .in('shop_id', shopIds)
      .eq('visit_type', 'sales')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at')
      .range(0, PAGE - 1);
    if (user_id) firstPageQ = firstPageQ.eq('user_id', user_id);
    const [{ data: firstPage, error: firstErr }, { data: periodCartons, error: pcErr }] = await Promise.all([
      firstPageQ,
      adminSupabase.rpc('get_period_summary', {
        p_region_ids:    effectiveRegionIds.length > 0 ? effectiveRegionIds : null,
        p_subregion_id:  subregion_id ? parseInt(subregion_id, 10) : null,
        p_user_id:       user_id || null,
        p_start:         start,
        p_end:           end,
      }),
    ]);
    if (firstErr) return res.status(500).json({ error: firstErr.message });
    if (!pcErr && periodCartons) {
      const ps = Array.isArray(periodCartons) ? periodCartons[0] : periodCartons;
      res.setHeader('X-Total-Cartons', String(ps?.total_cartons ?? 0));
      res.setHeader('X-Total-Visits',  String(ps?.total_visits  ?? 0));
      res.setHeader('X-Active-Shops',  String(ps?.active_shops  ?? 0));
    }
    if (firstPage) visits.push(...firstPage);
    // Keep fetching until a page comes back shorter than PAGE
    while (visits.length % PAGE === 0 && visits.length > 0) {
      offset += PAGE;
      let pageQ = adminSupabase
        .from('visits')
        .select('id, shop_id, created_at')
        .in('shop_id', shopIds)
        .eq('visit_type', 'sales')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at')
        .range(offset, offset + PAGE - 1);
      if (user_id) pageQ = pageQ.eq('user_id', user_id);
      const { data: pageData, error: pageErr } = await pageQ;
      if (pageErr) { vErr = pageErr; break; }
      if (!pageData || pageData.length === 0) break;
      visits.push(...pageData);
      if (pageData.length < PAGE) break;
    }
    if (vErr) return res.status(500).json({ error: vErr.message });

    // Fetch visit_items in chunks of 200 (bypasses URL length limit)
    const allVisitIds = visits.map(v => v.id);
    const CHUNK = 200;
    const itemsMap = {};
    for (let ci = 0; ci < allVisitIds.length; ci += CHUNK) {
      const chunk = allVisitIds.slice(ci, ci + CHUNK);
      const { data: items, error: iErr } = await adminSupabase
        .from('visit_items')
        .select('visit_id, product_id, sold')
        .in('visit_id', chunk);
      if (iErr) return res.status(500).json({ error: iErr.message });
      for (const item of (items || [])) {
        if (!itemsMap[item.visit_id]) itemsMap[item.visit_id] = [];
        itemsMap[item.visit_id].push(item);
      }
    }

    // Aggregate per shop
    const aggr = {};
    shopIds.forEach(id => {
      aggr[id] = { visits: 0, sold: 0, not_sold_visits: 0, last_visit: null, by_sku: {}, trend: {} };
    });

    visits.forEach(v => {
      if (!aggr[v.shop_id]) return;
      const a = aggr[v.shop_id];
      a.visits++;
      const visitItems = itemsMap[v.id] || [];
      const daySold = visitItems.reduce((s, i) => s + (i.sold || 0), 0);
      a.sold += daySold;
      if (daySold === 0) a.not_sold_visits++;
      const day = v.created_at.slice(0, 10);
      a.trend[day] = (a.trend[day] || 0) + daySold;
      if (!a.last_visit || v.created_at > a.last_visit) a.last_visit = v.created_at;
      visitItems.forEach(i => {
        if (i.sold > 0) a.by_sku[i.product_id] = (a.by_sku[i.product_id] || 0) + i.sold;
      });
    });

    const result = shops
      .map(s => {
        const a = aggr[s.id];
        const bySku = Object.entries(a.by_sku)
          .map(([pid, sold]) => ({ sku: productMap[parseInt(pid)]?.sku || '?', name: productMap[parseInt(pid)]?.name || 'Unknown', sold }))
          .filter(x => (x.sold || 0) > 0)
          .sort((a, b) => b.sold - a.sold);
        // Exclude shops that had zero sales visits (uplift-only or untouched shops)
        if (a.visits === 0) return null;
        const trend = Object.entries(a.trend)
          .map(([date, sold]) => ({ date, sold }))
          .sort((a, b) => a.date.localeCompare(b.date));
        const sr = subregionMap[s.subregion_id];
        return {
          shop_id: s.id, shop_name: s.name, shop_location: s.location || '',
          subregion_name: sr?.name || '—', region_name: regionMap[sr?.region_id] || '—',
          total_visits: a.visits, total_sold: a.sold,
          total_not_sold_visits: a.not_sold_visits,
          last_visit_date: a.last_visit ? a.last_visit.slice(0, 10) : null,
          top_sku: bySku[0]?.sku || null,
          by_sku: bySku, trend,
        };
      })
      .filter(x => x)
      .sort((a, b) => b.total_sold - a.total_sold);

    return res.status(200).json(result);
  }

  // ── MODE: UPLIFTS ─────────────────────────────────────────────────────
  const { data: uplifts, error: uErr } = await adminSupabase
    .from('uplifts')
    .select('id, shop_id, status, created_at, uplift_items(product_id, cartons)')
    .in('shop_id', shopIds)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at');
  if (uErr) return res.status(500).json({ error: uErr.message });

  const aggr = {};
  shopIds.forEach(id => {
    aggr[id] = { total: 0, approved: 0, rejected: 0, pending: 0, cartons: 0, last: null, by_sku: {}, trend: {} };
  });

  (uplifts || []).forEach(u => {
    if (!aggr[u.shop_id]) return;
    const a = aggr[u.shop_id];
    a.total++;
    if (u.status === 'approved') a.approved++;
    else if (u.status === 'rejected') a.rejected++;
    else a.pending++;
    const day = u.created_at.slice(0, 10);
    const dayCartons = (u.uplift_items || []).reduce((s, i) => s + (i.cartons || 0), 0);
    a.cartons += dayCartons;
    a.trend[day] = (a.trend[day] || 0) + dayCartons;
    if (!a.last || u.created_at > a.last) a.last = u.created_at;
    (u.uplift_items || []).forEach(i => {
      if (i.cartons > 0) a.by_sku[i.product_id] = (a.by_sku[i.product_id] || 0) + i.cartons;
    });
  });

  const result = shops
    .map(s => {
      const a = aggr[s.id];
      const bySku = Object.entries(a.by_sku)
        .map(([pid, cartons]) => ({ sku: productMap[parseInt(pid)]?.sku || '?', name: productMap[parseInt(pid)]?.name || 'Unknown', cartons }))
        .filter(x => (x.cartons || 0) > 0)
        .sort((a, b) => b.cartons - a.cartons);
      if (bySku.length === 0) return null;
      const trend = Object.entries(a.trend)
        .map(([date, cartons]) => ({ date, cartons }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const sr = subregionMap[s.subregion_id];
      return {
        shop_id: s.id, shop_name: s.name, shop_location: s.location || '',
        subregion_name: sr?.name || '—', region_name: regionMap[sr?.region_id] || '—',
        total_uplifts: a.total, approved_uplifts: a.approved,
        rejected_uplifts: a.rejected, pending_uplifts: a.pending,
        total_cartons_uplifted: a.cartons,
        last_uplift_date: a.last ? a.last.slice(0, 10) : null,
        by_sku: bySku, trend,
      };
    })
    .filter(x => x)
    .sort((a, b) => b.total_cartons_uplifted - a.total_cartons_uplifted);

  const hasFiltersUplifts = !!(subregion_id || region_id || dateFrom || dateTo || shop_id);
  if (!hasFiltersUplifts && result.length > 10) {
    res.setHeader('X-Data-Limited', 'true');
    return res.status(200).json(result.slice(0, 10));
  }
  return res.status(200).json(result);
}


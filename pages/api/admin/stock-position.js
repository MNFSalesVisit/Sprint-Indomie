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
 * GET /api/admin/stock-position
 *   [&region_id=N]      [&subregion_id=N]
 *
 * Returns stock balance per salesperson per SKU (all-time to date):
 *   Balance = Total Uplifted – Total Sold
 *
 * Response: [{
 *   user_id, full_name,
 *   skus: [{ product_id, sku, name, uplifted, sold, balance }]
 * }]
 * Sorted by salesperson name asc, SKU name asc within each person.
 */
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

  // Build effective region scope (intersection of admin's allowed + requested)
  const effectiveRegionIds = allowedRegionIds.length > 0
    ? (region_id ? allowedRegionIds.filter(id => id === parseInt(region_id)) : allowedRegionIds)
    : region_id ? [parseInt(region_id)] : [];

  // ── 1. Fetch all uplifts with their items ────────────────────────────────
  //    uplifts are user-level, so filter by user's region via shops.region_id
  let upliftsQ = adminSupabase
    .from('uplifts')
    .select(`
      id, user_id, shop_id, subregion_id,
      uplift_items(product_id, cartons)
    `)
    .eq('status', 'approved');

  if (effectiveRegionIds.length > 0) {
    const { data: shopRows } = await adminSupabase
      .from('shops').select('id').in('region_id', effectiveRegionIds);
    const allowedShopIds = (shopRows || []).map(s => s.id);
    if (allowedShopIds.length === 0) {
      // No shops in scope → everything is 0
      return res.status(200).json([]);
    }
    upliftsQ = upliftsQ.in('shop_id', allowedShopIds);
  }

  if (subregion_id) upliftsQ = upliftsQ.eq('subregion_id', parseInt(subregion_id));

  const { data: uplifts, error: upliftErr } = await upliftsQ;
  if (upliftErr) return res.status(500).json({ error: upliftErr.message });

  // ── 2. Fetch all sales visits with their items ───────────────────────────
  let visitsQ = adminSupabase
    .from('visits')
    .select(`
      id, user_id, region_id, subregion_id,
      visit_items(product_id, sold)
    `)
    .eq('visit_type', 'sales');

  if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);
  if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id));

  const { data: visits, error: visitErr } = await visitsQ;
  if (visitErr) return res.status(500).json({ error: visitErr.message });

  // ── 3. Fetch products ────────────────────────────────────────────────────
  const { data: products } = await adminSupabase
    .from('products')
    .select('id, sku, name, sort_order')
    .eq('is_active', true)
    .order('sort_order')
    .order('id');
  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p; });

  // ── 4. Gather all user IDs from both tables ──────────────────────────────
  const userIds = [...new Set([
    ...(uplifts || []).map(u => u.user_id),
    ...(visits  || []).map(v => v.user_id),
  ].filter(Boolean))];

  if (userIds.length === 0) return res.status(200).json([]);

  const { data: appUsers } = await adminSupabase
    .from('app_users')
    .select('id, full_name, email, roles(name)')
    .in('id', userIds);
  const userMap = {};
  (appUsers || []).forEach(u => {
    // Only include Salesperson role
    if (u.roles?.name === 'Salesperson') {
      userMap[u.id] = u.full_name || u.email;
    }
  });

  // ── 4.5. Fetch live stock balances (uplifts add, sales deduct, manual adj overwrites) ──────
  // stock_balances.quantity is the authoritative current balance.
  // We derive: manually_added = balance − (uplifted − sold)
  const stockBalMap = {}; // { user_id: { product_id: quantity } }
  const salespersonIds = Object.keys(userMap);
  if (salespersonIds.length > 0) {
    const { data: stockBalances } = await adminSupabase
      .from('stock_balances')
      .select('user_id, product_id, quantity')
      .in('user_id', salespersonIds);
    for (const sb of (stockBalances || [])) {
      if (!stockBalMap[sb.user_id]) stockBalMap[sb.user_id] = {};
      stockBalMap[sb.user_id][sb.product_id] = sb.quantity ?? 0;
    }
  }

  // ── 5. Aggregate uplifted per user per product ───────────────────────────
  // upliftAggr: { user_id: { product_id: cartons } }
  const upliftAggr = {};
  for (const uplift of (uplifts || [])) {
    if (!uplift.user_id || !userMap[uplift.user_id]) continue;
    if (!upliftAggr[uplift.user_id]) upliftAggr[uplift.user_id] = {};
    for (const item of (uplift.uplift_items || [])) {
      if (!item.product_id || !item.cartons) continue;
      upliftAggr[uplift.user_id][item.product_id] =
        (upliftAggr[uplift.user_id][item.product_id] || 0) + item.cartons;
    }
  }

  // ── 6. Aggregate sold per user per product ───────────────────────────────
  // soldAggr: { user_id: { product_id: sold } }
  const soldAggr = {};
  for (const visit of (visits || [])) {
    if (!visit.user_id || !userMap[visit.user_id]) continue;
    if (!soldAggr[visit.user_id]) soldAggr[visit.user_id] = {};
    for (const item of (visit.visit_items || [])) {
      if (!item.product_id || !(item.sold > 0)) continue;
      soldAggr[visit.user_id][item.product_id] =
        (soldAggr[visit.user_id][item.product_id] || 0) + item.sold;
    }
  }

  // ── 7. Build result ──────────────────────────────────────────────────────
  // Only include salesperson users
  const result = Object.keys(userMap)
    .map(uid => {
      const uplifted  = upliftAggr[uid] || {};
      const sold      = soldAggr[uid]   || {};
      const stockBals = stockBalMap[uid] || {};

      // Union of all product IDs this user touched
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
          // Use live balance from stock_balances when available (authoritative),
          // fall back to transaction-based calculation when no record exists.
          const balVal = stockBals[pid] !== undefined ? stockBals[pid] : (u - s);
          // manually_added = what the super admin effectively added/corrected
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
        // Sort by sort_order then SKU name
        .sort((a, b) => a.sort_order - b.sort_order || a.sku.localeCompare(b.sku))
        // Drop SKUs where everything is 0
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

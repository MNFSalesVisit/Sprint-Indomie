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
  const { year, month, region_id, subregion_id, user_id, date_from, date_to } = req.query;

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

  // ── Visits ──────────────────────────────────────────────────────────────
  let visitsQuery = adminSupabase
    .from('visits')
    .select(`
      id, visit_type, latitude, longitude, selfie_path, created_at,
      app_users!visits_user_id_fkey ( id, full_name ),
      shops ( id, name, location, latitude, longitude, region_id, subregion_id ),
      visit_items (
        sold, stock_position, not_sold_reason,
        products ( id, sku, name )
      )
    `)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('created_at', { ascending: false });

  if (allowedRegionIds.length > 0) {
    const targetRegions = region_id
      ? [parseInt(region_id)].filter(id => allowedRegionIds.includes(id))
      : allowedRegionIds;
    if (targetRegions.length === 0) return res.status(200).json([]);
    visitsQuery = visitsQuery.in('region_id', targetRegions);
  } else if (region_id) {
    visitsQuery = visitsQuery.eq('region_id', parseInt(region_id));
  }
  if (subregion_id) visitsQuery = visitsQuery.eq('subregion_id', parseInt(subregion_id));
  if (user_id)      visitsQuery = visitsQuery.eq('user_id', user_id);

  const { data: visits, error: visitErr } = await visitsQuery;
  if (visitErr) return res.status(500).json({ error: visitErr.message });

  // ── Uplifts ────────────────────────────────────────────────────────────
  let upliftsQuery = adminSupabase
    .from('uplifts')
    .select(`
      id, cartons, status, rejected_reason, created_at,
      app_users!uplifts_user_id_fkey ( id, full_name ),
      shops ( id, name, location, latitude, longitude, region_id, subregion_id ),
      uplift_items (
        cartons,
        products ( id, sku, name )
      )
    `)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .not('shops.latitude', 'is', null);

  if (user_id) upliftsQuery = upliftsQuery.eq('user_id', user_id);

  let skipUplifts = false;
  if (allowedRegionIds.length > 0) {
    const { data: shopRows } = await adminSupabase
      .from('shops').select('id').in('region_id', allowedRegionIds);
    const upliftShopIds = (shopRows || []).map(s => s.id);
    if (upliftShopIds.length === 0) skipUplifts = true;
    else upliftsQuery = upliftsQuery.in('shop_id', upliftShopIds);
  }

  const { data: uplifts, error: upliftErr } = skipUplifts
    ? { data: [], error: null }
    : await upliftsQuery;
  if (upliftErr) return res.status(500).json({ error: upliftErr.message });

  const markers = [];

  // ── Process visits (no signed URL generation) ──────────────────────────
  for (const v of visits || []) {
    const lat = v.latitude  ?? v.shops?.latitude;
    const lng = v.longitude ?? v.shops?.longitude;
    if (!lat || !lng) continue;
    if (region_id && v.shops?.region_id !== parseInt(region_id)) continue;
    if (subregion_id && v.shops?.subregion_id !== parseInt(subregion_id)) continue;

    const totalSold = (v.visit_items || []).reduce((s, i) => s + (i.sold || 0), 0);
    const anyReason = (v.visit_items || []).find(i => i.not_sold_reason);
    const type = totalSold > 0 ? 'sold' : 'not_sold';

    const skus = (v.visit_items || []).map(i => ({
      sku:              i.products?.sku || '—',
      name:             i.products?.name || '—',
      sold:             i.sold || 0,
      stock_position:   i.stock_position || 0,
      not_sold_reason:  i.not_sold_reason || null,
      cartons_uplifted: 0,
    }));

    markers.push({
      id:               `visit-${v.id}`,
      shop_id:          v.shops?.id || null,
      shop_name:        v.shops?.name || 'Unknown Shop',
      shop_location:    v.shops?.location || null,
      latitude:         lat,
      longitude:        lng,
      type,
      salesperson_name: v.app_users?.full_name || 'Unknown',
      selfie_path:      v.selfie_path,    // only path – frontend will fetch signed URL on click
      selfie_url:       null,
      skus,
      total_sold:       totalSold,
      total_uplifted:   0,
      not_sold_reason:  anyReason?.not_sold_reason || null,
      visited_at:       v.created_at,
    });
  }

  // ── Process uplifts ────────────────────────────────────────────────────
  for (const u of uplifts || []) {
    const lat = u.shops?.latitude;
    const lng = u.shops?.longitude;
    if (!lat || !lng) continue;
    if (region_id    && u.shops?.region_id    !== parseInt(region_id))    continue;
    if (subregion_id && u.shops?.subregion_id !== parseInt(subregion_id)) continue;

    const totalUplifted = (u.uplift_items || []).reduce((s, i) => s + (i.cartons || 0), 0);
    const skus = (u.uplift_items || []).map(i => ({
      sku:              i.products?.sku || '—',
      name:             i.products?.name || '—',
      sold:             0,
      stock_position:   0,
      not_sold_reason:  null,
      cartons_uplifted: i.cartons || 0,
    }));

    markers.push({
      id:               `uplift-${u.id}`,
      shop_id:          u.shops?.id || null,
      shop_name:        u.shops?.name || 'Unknown Shop',
      shop_location:    u.shops?.location || null,
      latitude:         lat,
      longitude:        lng,
      type:             'uplift',
      salesperson_name: u.app_users?.full_name || 'Unknown',
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

  // ── Unvisited shops (show_all=1) ───────────────────────────────────────
  if (req.query.show_all === '1') {
    const visitedShopIds = new Set(markers.map(m => m.shop_id).filter(Boolean));

    let shopsQuery = adminSupabase
      .from('shops')
      .select('id, name, location, latitude, longitude, region_id, subregion_id')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (allowedRegionIds.length > 0) {
      const targetRegions = region_id
        ? [parseInt(region_id)].filter(id => allowedRegionIds.includes(id))
        : allowedRegionIds;
      if (targetRegions.length === 0) return res.status(200).json(markers);
      shopsQuery = shopsQuery.in('region_id', targetRegions);
    } else if (region_id) {
      shopsQuery = shopsQuery.eq('region_id', parseInt(region_id));
    }
    if (subregion_id) shopsQuery = shopsQuery.eq('subregion_id', parseInt(subregion_id));

    const { data: allShops } = await shopsQuery;
    for (const shop of (allShops || [])) {
      if (visitedShopIds.has(shop.id)) continue;
      markers.push({
        id:            `unvisited-${shop.id}`,
        shop_id:       shop.id,
        shop_name:     shop.name  || 'Unknown Shop',
        shop_location: shop.location || null,
        latitude:      shop.latitude,
        longitude:     shop.longitude,
        type:          'unvisited',
      });
    }
  }

  return res.status(200).json(markers);
}
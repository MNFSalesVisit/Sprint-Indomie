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

/**
 * GET /api/admin/visit-detail
 *   ?user_id=UUID&year=YYYY&month=M
 *   [&dateFrom=YYYY-MM-DD] [&dateTo=YYYY-MM-DD]
 *   [&subregion_id=N]
 *
 * Returns full visit breakdown for one salesperson:
 * [{
 *   visit_id, created_at, shop_name, shop_location,
 *   visit_sold, total_sold_cartons,
 *   items: [{ sku, product_name, sold, stock_position, not_sold_reason }]
 * }]
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  const { allowedRegionIds } = admin;

  const { user_id, year, month, dateFrom, dateTo, subregion_id } = req.query;
  if (!user_id || !year || !month) return res.status(400).json({ error: 'user_id, year and month are required' });

  const y = parseInt(year);
  const m = parseInt(month);
  const start = dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : new Date(y, m - 1, 1).toISOString();
  const end   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').toISOString() : new Date(y, m, 1).toISOString();

  const _SELECT = `
      id, created_at,
      shops ( name, location ),
      visit_items (
        sold, stock_position, not_sold_reason,
        products ( sku, name )
      )
    `;
  const _PAGE = 1000;
  let _page   = 0;
  const visits = [];
  let fetchErr = null;
  while (true) {
    let q = adminSupabase
      .from('visits')
      .select(_SELECT)
      .eq('user_id', user_id)
      .eq('visit_type', 'sales')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .range(_page * _PAGE, (_page + 1) * _PAGE - 1);
    if (subregion_id) q = q.eq('subregion_id', parseInt(subregion_id));
    if (allowedRegionIds.length > 0) q = q.in('region_id', allowedRegionIds);
    const { data: _rows, error: _err } = await q;
    if (_err) { fetchErr = _err; break; }
    if (!_rows || _rows.length === 0) break;
    visits.push(..._rows);
    if (_rows.length < _PAGE) break;
    _page++;
  }
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const result = (visits || []).map(v => {
    const items = (v.visit_items || [])
      .filter(i => (i.sold ?? 0) > 0 || !!i.not_sold_reason)
      .map(i => ({
      sku:             i.products?.sku        || '—',
      product_name:    i.products?.name       || 'Unknown',
      sold:            i.sold                 ?? 0,
      stock_position:  i.stock_position       ?? 0,
      not_sold_reason: i.not_sold_reason      || '',
    }));
    const totalSold = items.reduce((s, i) => s + i.sold, 0);
    return {
      visit_id:           v.id,
      created_at:         v.created_at,
      shop_name:          v.shops?.name     || 'Unknown Shop',
      shop_location:      v.shops?.location || '',
      visit_sold:         totalSold > 0,
      total_sold_cartons: totalSold,
      items,
    };
  });

  return res.status(200).json(result);
}

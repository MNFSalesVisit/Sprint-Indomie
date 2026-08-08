import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function parseDateOnlyUTC(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

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

// GET /api/admin/customer-insights?region_id=&sales_rep=&dateFrom=&dateTo=
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorised' });
    const admin = await verifyAdmin(token);
    if (!admin) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    const { allowedRegionIds } = admin;

    const { region_id, sales_rep, dateFrom, dateTo } = req.query || {};

    // Fetch shops within allowed regions (and optional region filter)
    let shopsQ = adminSupabase.from('shops').select('id, name, subregion_id, region_id').order('name');
    if (region_id) shopsQ = shopsQ.eq('region_id', parseInt(region_id, 10));
    if (allowedRegionIds && allowedRegionIds.length > 0) shopsQ = shopsQ.in('region_id', allowedRegionIds);
    const { data: shops, error: shopErr } = await shopsQ;
    if (shopErr) return res.status(500).json({ error: shopErr.message });
    if (!shops || shops.length === 0) return res.status(200).json([]);
    const shopIds = shops.map(s => s.id);

    // Build visits query
    let visitsQ = adminSupabase
      .from('visits')
      .select('id, shop_id, created_at, user_id, visit_items(sold, not_sold_reason)')
      .in('shop_id', shopIds)
      .eq('visit_type', 'sales')
      .order('created_at', { ascending: true });

    if (dateFrom) {
      const startDate = parseDateOnlyUTC(dateFrom);
      if (startDate) visitsQ = visitsQ.gte('created_at', startDate.toISOString());
    }
    if (dateTo) {
      const toDate = parseDateOnlyUTC(dateTo);
      if (toDate) visitsQ = visitsQ.lt('created_at', new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() + 1)).toISOString());
    }
    if (sales_rep) visitsQ = visitsQ.eq('user_id', sales_rep);

    const { data: visits, error: vErr } = await visitsQ;
    if (vErr) return res.status(500).json({ error: vErr.message });

    // Aggregate per shop
    const aggr = {};
    shops.forEach(s => {
      aggr[s.id] = {
        shop_id: s.id,
        shop_name: s.name,
        total_visits: 0,
        total_sales: 0,
        total_cartons: 0,
        not_sold_count: 0,
        reason_counts: { financial: 0, stock: 0, other: 0 },
        last_visit_date: null,
      };
    });

    (visits || []).forEach(v => {
      const s = aggr[v.shop_id];
      if (!s) return;
      s.total_visits++;
      const items = v.visit_items || [];
      const totalSold = items.reduce((sum, it) => sum + (it.sold || 0), 0);
      s.total_cartons += totalSold;
      if (totalSold > 0) s.total_sales++;
      else s.not_sold_count++;

      // Reason: consider any not_sold_reason values on items when totalSold===0
      if (totalSold === 0) {
        for (const it of items) {
          const r = (it.not_sold_reason || '').toString().toLowerCase();
          if (!r) continue;
          if (r.includes('financial')) { s.reason_counts.financial++; break; }
          if (r.includes('stock'))     { s.reason_counts.stock++; break; }
          s.reason_counts.other++; break;
        }
      }

      if (!s.last_visit_date || v.created_at > s.last_visit_date) s.last_visit_date = v.created_at;
    });

    // Compute metrics and recommendations
    const out = Object.values(aggr).map(s => {
      const total_visits = s.total_visits || 0;
      const total_sales = s.total_sales || 0;
      const total_cartons = s.total_cartons || 0;
      const not_sold_count = s.not_sold_count || 0;
      const efficiency = total_visits > 0 ? Math.round((total_sales / total_visits) * 100) : 0;
      const problem = (total_visits >= 3 && total_sales === 0) || (efficiency < 20 && total_visits > 0);

      // majority reason
      const rc = s.reason_counts || { financial: 0, stock: 0, other: 0 };
      let majority = null;
      if (rc.financial >= rc.stock && rc.financial >= rc.other && rc.financial > 0) majority = 'financial';
      else if (rc.stock >= rc.financial && rc.stock >= rc.other && rc.stock > 0) majority = 'stock';
      else if (rc.other > 0) majority = 'other';

      // Recommendation precedence: problem -> high efficiency -> majority reason -> default
      let recommendation = 'Regular monitoring (weekly)';
      if (problem) recommendation = 'Low performance – reduce visits or reassess';
      else if (efficiency > 60) recommendation = 'High value shop – visit frequently (2–3 days)';
      else if (majority === 'financial') recommendation = 'Revisit in 3–7 days';
      else if (majority === 'stock') recommendation = 'Revisit in 7–14 days';

      const priority = (total_sales * 3) + (total_cartons * 2) - (not_sold_count * 2);

      return {
        shop_id: s.shop_id,
        shop_name: s.shop_name,
        total_visits,
        total_sales,
        total_cartons,
        efficiency,
        problem,
        recommendation,
        priority,
        last_visit_date: s.last_visit_date ? (typeof s.last_visit_date === 'string' ? s.last_visit_date.slice(0,10) : new Date(s.last_visit_date).toISOString().slice(0,10)) : null,
      };
    });

    // sort by priority desc
    out.sort((a,b) => b.priority - a.priority);

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

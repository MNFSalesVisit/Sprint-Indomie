import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Kenya = UTC+3
function toEAT(iso) {
  const ms = new Date(iso).getTime() + 3 * 60 * 60 * 1000;
  const d  = new Date(ms);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}

async function verifyAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return false;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: appUser } = await adminSupabase
    .from('app_users').select('role_id').eq('email', data.user.email).single();
  if (!appUser) return false;
  const { data: role } = await adminSupabase
    .from('roles').select('name').eq('id', appUser.role_id).single();
  return ['Super Admin', 'Admin'].includes(role?.name);
}

// Paginate a query builder factory through all pages
async function fetchAllPages(queryFn, pageSize = 1000, maxRows = 20000) {
  const all = [];
  let offset = 0;
  while (all.length < maxRows) {
    const { data, error } = await queryFn().range(offset, offset + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

const VISITS_SELECT = `
  id, created_at, latitude, longitude, visit_type,
  app_users!visits_user_id_fkey ( full_name ),
  shops ( name, location, latitude, longitude ),
  regions ( name ),
  subregions ( name ),
  visit_items (
    sold, stock_position, not_sold_reason,
    products ( sku, name )
  )
`;

const UPLIFTS_SELECT = `
  id, created_at, status,
  app_users!uplifts_user_id_fkey ( full_name ),
  shops ( id, name, location, latitude, longitude, region_id, subregion_id,
    regions ( name ),
    subregions ( name )
  ),
  uplift_items (
    cartons,
    products ( sku, name )
  )
`;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const ok = await verifyAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  const { action, year, month, date_from, date_to, user_id, region_id, subregion_id } = req.query;

  // ── Filter helper data ──────────────────────────────────────────────────
  if (action === 'filters') {
    const [usersRes, regionsRes] = await Promise.all([
      adminSupabase.from('app_users').select('id, full_name').order('full_name'),
      adminSupabase.from('regions').select('id, name').order('name'),
    ]);
    return res.status(200).json({
      users:   usersRes.data  || [],
      regions: regionsRes.data || [],
    });
  }

  if (action === 'subregions') {
    let q = adminSupabase.from('subregions').select('id, name, region_id').order('name');
    if (region_id) q = q.eq('region_id', parseInt(region_id));
    const { data } = await q;
    return res.status(200).json(data || []);
  }

  // ── Build date range ────────────────────────────────────────────────────
  let start, end;
  if (date_from || date_to) {
    start = new Date((date_from || '2000-01-01') + 'T00:00:00Z');
    end   = new Date((date_to   || '2099-12-31') + 'T23:59:59Z');
  } else if (year && month) {
    start = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
    end   = new Date(Date.UTC(parseInt(year), parseInt(month),     0, 23, 59, 59));
  } else if (year) {
    start = new Date(Date.UTC(parseInt(year), 0,  1));
    end   = new Date(Date.UTC(parseInt(year), 11, 31, 23, 59, 59));
  } else {
    const now = new Date();
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  }

  const startISO = start.toISOString();
  const endISO   = end.toISOString();

  // ── Fetch visits (paginated) ────────────────────────────────────────────
  const visits = await fetchAllPages(() => {
    let q = adminSupabase
      .from('visits')
      .select(VISITS_SELECT)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .order('created_at', { ascending: false });
    if (user_id)      q = q.eq('user_id', user_id);
    if (region_id)    q = q.eq('region_id',    parseInt(region_id));
    if (subregion_id) q = q.eq('subregion_id', parseInt(subregion_id));
    return q;
  });

  // ── Fetch uplifts (paginated) ───────────────────────────────────────────
  const uplifts = await fetchAllPages(() => {
    let q = adminSupabase
      .from('uplifts')
      .select(UPLIFTS_SELECT)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .order('created_at', { ascending: false });
    if (user_id) q = q.eq('user_id', user_id);
    return q;
  });

  // ── Flatten visits ──────────────────────────────────────────────────────
  const rows = [];

  for (const v of visits) {
    const { date, time } = toEAT(v.created_at);
    const items      = v.visit_items || [];
    // Use visit GPS first, fall back to shop coordinates
    const lat        = v.latitude  ?? v.shops?.latitude  ?? '';
    const lng        = v.longitude ?? v.shops?.longitude ?? '';
    // Only rows where something was actually sold
    const soldItems  = items.filter(i => (i.sold || 0) > 0);
    const totalSold  = items.reduce((s, i) => s + (i.sold || 0), 0);
    const soldLabel  = items.length > 0 ? (totalSold > 0 ? 'Yes' : 'No') : '';

    const base = {
      'Record Type':   'Visit',
      'Date':          date,
      'Time (EAT)':    time,
      'Salesperson':   v.app_users?.full_name || '',
      'Region':        v.regions?.name        || '',
      'Subregion':     v.subregions?.name     || '',
      'Shop Name':     v.shops?.name          || '',
      'Shop Location': v.shops?.location      || '',
      'Sold':          soldLabel,
      'Uplift Status': '',
      'Latitude':      lat,
      'Longitude':     lng,
    };

    if (soldItems.length === 0) {
      // Visit happened but nothing sold — one summary row, no SKU breakdown
      const reason = items.find(i => i.not_sold_reason)?.not_sold_reason || '';
      rows.push({ ...base, 'Not Sold Reason': reason, 'SKU': '', 'Product Name': '', 'Cartons Sold': '', 'Cartons Uplifted': '', 'Stock Position': '' });
    } else {
      for (const item of soldItems) {
        rows.push({
          ...base,
          'Not Sold Reason':  '',
          'SKU':              item.products?.sku  || '',
          'Product Name':     item.products?.name || '',
          'Cartons Sold':     item.sold           ?? 0,
          'Cartons Uplifted': '',
          'Stock Position':   item.stock_position ?? '',
        });
      }
    }
  }

  // ── Flatten uplifts ─────────────────────────────────────────────────────
  for (const u of uplifts) {
    // JS-side region/subregion filter (uplifts table has no region_id column)
    if (region_id    && u.shops?.region_id    !== parseInt(region_id))    continue;
    if (subregion_id && u.shops?.subregion_id !== parseInt(subregion_id)) continue;

    const { date, time } = toEAT(u.created_at);
    const items = u.uplift_items || [];
    // Only items with actual cartons
    const activeItems = items.filter(i => (i.cartons || 0) > 0);

    const base = {
      'Record Type':   'Uplift',
      'Date':          date,
      'Time (EAT)':    time,
      'Salesperson':   u.app_users?.full_name    || '',
      'Region':        u.shops?.regions?.name    || '',
      'Subregion':     u.shops?.subregions?.name || '',
      'Shop Name':     u.shops?.name             || '',
      'Shop Location': u.shops?.location         || '',
      'Sold':          '',
      'Uplift Status': u.status                  || '',
      'Latitude':      u.shops?.latitude         ?? '',
      'Longitude':     u.shops?.longitude        ?? '',
    };

    if (activeItems.length === 0) {
      rows.push({ ...base, 'Not Sold Reason': '', 'SKU': '', 'Product Name': '', 'Cartons Sold': '', 'Cartons Uplifted': '', 'Stock Position': '' });
    } else {
      for (const item of activeItems) {
        rows.push({
          ...base,
          'Not Sold Reason':  '',
          'SKU':              item.products?.sku  || '',
          'Product Name':     item.products?.name || '',
          'Cartons Sold':     '',
          'Cartons Uplifted': item.cartons        ?? 0,
          'Stock Position':   '',
        });
      }
    }
  }

  // Sort combined rows by date/time descending
  rows.sort((a, b) => {
    const da = a['Date'] + 'T' + a['Time (EAT)'];
    const db = b['Date'] + 'T' + b['Time (EAT)'];
    return db.localeCompare(da);
  });

  return res.status(200).json({ rows, total: rows.length });
}

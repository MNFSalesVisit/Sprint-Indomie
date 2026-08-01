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

function parseDateValue(value, fallback) {
  if (!value) return fallback;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return fallback;
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function buildDateWindow(dateFrom, dateTo, year, month) {
  if (dateFrom || dateTo) {
    const startDate = parseDateValue(dateFrom, new Date(Date.UTC(2000, 0, 1)));
    const endDate = parseDateValue(dateTo, new Date(Date.UTC(2100, 11, 31)));
    return {
      start: startDate.toISOString(),
      end: new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 59, 59, 999)).toISOString(),
    };
  }

  if (year && month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    return {
      start: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString(),
      end: new Date(Date.UTC(y, m, 1, 0, 0, 0)).toISOString(),
    };
  }

  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString(),
  };
}

/**
 * GET /api/admin/reasons-not-sold
 *   [&region_id=N]        [&subregion_id=N]
 *   [&user_id=UUID]
 *   [&date_from=YYYY-MM-DD] [&date_to=YYYY-MM-DD]
 *   [&year=YYYY] [&month=M]
 *   [&page=N] [&per_page=N]        (default page=1, per_page=20, max 100)
 *
 * Returns visits where total sold = 0, with the not-sold reason.
 * Sorted by visited_at desc.
 * Default (no filters) → 10 records; filtered → full dataset with pagination.
 *
 * Response headers:
 *   X-Data-Limited: true   when result is capped at 10 (no filters)
 *   X-Total-Count: N       total not-sold visits count
 *   X-Top-Reason: text     most common reason
 *   X-Top-Region: text     region with most not-sold visits
 *   X-Page: N              current page
 *   X-Per-Page: N          items per page
 *   X-Total-Pages: N       total pages available
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, no-store');
  logApiCall('/api/admin/reasons-not-sold', 'admin');
  await applyLowPriorityThrottle();

  const { allowedRegionIds } = admin;
  const {
    region_id,
    subregion_id,
    user_id,
    date_from,
    date_to,
    year,
    month,
    page,
    per_page,
  } = req.query;

  // ── Pagination params ───────────────────────────────────────────────────
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const itemsPerPage = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));

  // ── Determine if any real filter is applied ─────────────────────────────
  const hasFilters =
    region_id || subregion_id || user_id || date_from || date_to || (year && month);

  // ── Build date window (UTC so month boundaries don't shift) ─────────────
  const { start, end } = buildDateWindow(date_from, date_to, year, month);

  // ── Build effective region scope ────────────────────────────────────────
  let effectiveRegionIds = [];
  if (allowedRegionIds.length > 0) {
    effectiveRegionIds = region_id
      ? allowedRegionIds.filter(id => id === parseInt(region_id, 10))
      : allowedRegionIds;
    if (effectiveRegionIds.length === 0) {
      res.setHeader('X-Total-Count', '0');
      res.setHeader('X-Top-Reason', '');
      res.setHeader('X-Top-Region', '');
      res.setHeader('X-Page', '1');
      res.setHeader('X-Per-Page', String(itemsPerPage));
      res.setHeader('X-Total-Pages', '0');
      return res.status(200).json([]);
    }
  } else if (region_id) {
    effectiveRegionIds = [parseInt(region_id, 10)];
  }

  // ── Fetch visits ────────────────────────────────────────────────────────
  let visitsQ = adminSupabase
    .from('visits')
    .select(
      'id, region_id, subregion_id, latitude, longitude, selfie_path, created_at,' +
      'app_users!visits_user_id_fkey ( id, full_name ),' +
      'shops ( id, name, location, subregion_id, subregions ( id, name ), regions ( id, name ) )'
    )
    .eq('visit_type', 'sales')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: false });

  // CRITICAL FIX: only cap at 10 when the user has NOT asked for a specific filter
  if (!hasFilters) {
    visitsQ = visitsQ.limit(10);
    res.setHeader('X-Data-Limited', 'true');
  }

  if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);
  if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id, 10));
  if (user_id)      visitsQ = visitsQ.eq('user_id', user_id);

  const { data: visits, error: visitErr } = await visitsQ;
  if (visitErr) return res.status(500).json({ error: visitErr.message });

  if (!visits || visits.length === 0) {
    res.setHeader('X-Total-Count', '0');
    res.setHeader('X-Top-Reason', '');
    res.setHeader('X-Top-Region', '');
    res.setHeader('X-Page', '1');
    res.setHeader('X-Per-Page', String(itemsPerPage));
    res.setHeader('X-Total-Pages', '0');
    return res.status(200).json([]);
  }

  // ── Fetch visit_items separately (avoids JOIN timeout) ──────────────────
  const visitIds = visits.map(v => v.id);
  const { data: visitItemsRaw, error: itemErr } = await adminSupabase
    .from('visit_items')
    .select('visit_id, sold, not_sold_reason')
    .in('visit_id', visitIds);
  if (itemErr) return res.status(500).json({ error: itemErr.message });

  const itemsMap = {};
  for (const item of (visitItemsRaw || [])) {
    if (!itemsMap[item.visit_id]) itemsMap[item.visit_id] = [];
    itemsMap[item.visit_id].push(item);
  }

  // ── Filter to not-sold visits with explicit reasons ─────────────────────
  const notSoldVisitsRaw = [];
  for (const v of visits) {
    const items = (itemsMap[v.id] || []).filter(item => item && (item.sold || 0) > 0 || item?.not_sold_reason);
    const totalSold = items.reduce((s, i) => s + (i.sold || 0), 0);
    const reasons = items
      .filter(i => i.not_sold_reason && String(i.not_sold_reason).trim() !== '')
      .map(i => String(i.not_sold_reason).trim());

    // Match the rest of the app: a visit is considered not sold when the summed
    // cartons sold is zero and there is at least one explicit not-sold reason.
    if (totalSold > 0 || reasons.length === 0) continue;

    const rawReason = reasons[0];
    const reason = rawReason.toLowerCase() === 'other' ? 'Other (no details provided)' : rawReason;

    notSoldVisitsRaw.push({
      visit_id:         v.id,
      shop_name:        v.shops?.name             || 'Unknown Shop',
      shop_location:    v.shops?.location         || null,
      subregion_name:   v.shops?.subregions?.name || null,
      region_name:      v.shops?.regions?.name    || null,
      salesperson_name: v.app_users?.full_name    || 'Unknown',
      visited_at:       v.created_at,
      reason,
      latitude:         v.latitude  ?? null,
      longitude:        v.longitude ?? null,
      selfie_path:      v.selfie_path || null,
      selfie_url:       null,
    });
  }

  notSoldVisitsRaw.sort((a, b) => new Date(b.visited_at) - new Date(a.visited_at));

  // ── Sign selfie URLs (skip for large sets to avoid storage timeout) ─────
  if (notSoldVisitsRaw.length <= 80) {
    await Promise.all(
      notSoldVisitsRaw
        .filter(entry => entry.selfie_path)
        .map(async entry => {
          const { data: signed } = await adminSupabase.storage
            .from('visit-media')
            .createSignedUrl(entry.selfie_path, 3600);
          entry.selfie_url = signed?.signedUrl || null;
        })
    );
  }

  // ── Summary metadata ────────────────────────────────────────────────────
  const total = notSoldVisitsRaw.length;

  const reasonCounts = {};
  notSoldVisitsRaw.forEach(r => { reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1; });
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const regionCounts = {};
  notSoldVisitsRaw.forEach(r => {
    if (r.region_name) regionCounts[r.region_name] = (regionCounts[r.region_name] || 0) + 1;
  });
  const topRegion = Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // ── Pagination slice ────────────────────────────────────────────────────
  const totalPages = Math.ceil(total / itemsPerPage);
  const safePage = Math.min(currentPage, totalPages || 1);
  const startIndex = (safePage - 1) * itemsPerPage;
  const paginatedVisits = notSoldVisitsRaw.slice(startIndex, startIndex + itemsPerPage);

  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Top-Reason',  topReason);
  res.setHeader('X-Top-Region',  topRegion);
  res.setHeader('X-Page',        String(safePage));
  res.setHeader('X-Per-Page',    String(itemsPerPage));
  res.setHeader('X-Total-Pages', String(totalPages));

  return res.status(200).json(paginatedVisits);
}
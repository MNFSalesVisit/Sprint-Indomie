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
 * GET /api/admin/reasons-not-sold
 *   [&region_id=N]        [&subregion_id=N]
 *   [&user_id=UUID]
 *   [&date_from=YYYY-MM-DD] [&date_to=YYYY-MM-DD]
 *
 * Returns visits where total sold = 0, with the not-sold reason.
 * [{
 *   visit_id, shop_name, shop_location, subregion_name, region_name,
 *   salesperson_name, visited_at,
 *   reason,
 *   latitude, longitude, selfie_path, selfie_url,
 * }]
 * Sorted by visited_at desc.
 * Default (no filters) → 10 records; filtered → full dataset.
 *
 * Response headers:
 *   X-Data-Limited: true   when result is capped at 10
 *   X-Total-Count: N       total not-sold visits count (for summary)
 *   X-Top-Reason: text     most common reason
 *   X-Top-Region: text     region with most not-sold visits
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
  const { region_id, subregion_id, user_id, date_from, date_to, year, month } = req.query;

  // ── Build date window ───────────────────────────────────────────────────
  // Priority: explicit date_from/date_to > year+month > current month default
  let start, end;
  if (date_from || date_to) {
    start = date_from ? new Date(date_from + 'T00:00:00').toISOString() : new Date(2000, 0, 1).toISOString();
    end   = date_to   ? new Date(date_to   + 'T23:59:59.999').toISOString() : new Date(Date.now() + 86400000).toISOString();
  } else if (year && month) {
    const y = parseInt(year);
    const m = parseInt(month);
    start = new Date(y, m - 1, 1).toISOString();
    end   = new Date(y, m, 1).toISOString();
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    end   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }

  // ── Build effective region scope ────────────────────────────────────────
  let effectiveRegionIds = [];
  if (allowedRegionIds.length > 0) {
    effectiveRegionIds = region_id
      ? allowedRegionIds.filter(id => id === parseInt(region_id))
      : allowedRegionIds;
    if (effectiveRegionIds.length === 0) return res.status(200).json([]);
  } else if (region_id) {
    effectiveRegionIds = [parseInt(region_id)];
  }

  // ── Fetch visits in window (no nested visit_items to avoid JOIN timeout) ──
  // Split into two queries: visits first, then visit_items separately.
  // This matches the pattern used in customer-analysis.js and avoids DB timeouts
  // on large datasets where the nested JOIN becomes expensive.
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
    .order('created_at', { ascending: false })
    .limit(500);

  if (effectiveRegionIds.length > 0) visitsQ = visitsQ.in('region_id', effectiveRegionIds);
  if (subregion_id) visitsQ = visitsQ.eq('subregion_id', parseInt(subregion_id));
  if (user_id)      visitsQ = visitsQ.eq('user_id', user_id);

  const { data: visits, error: visitErr } = await visitsQ;
  if (visitErr) return res.status(500).json({ error: visitErr.message });

  if (!visits || visits.length === 0) {
    res.setHeader('X-Total-Count', '0');
    res.setHeader('X-Top-Reason', '');
    res.setHeader('X-Top-Region', '');
    return res.status(200).json([]);
  }

  // ── Fetch visit_items in a separate query ──────────────────────────────
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

  // ── Filter to only not-sold visits with explicit reasons ────────────────
  // Only include visits where (a) total sold = 0 AND (b) at least one item
  // has a non-null not_sold_reason — this prevents visits that happened to
  // record 0 sales (but were never explicitly marked "not sold") from
  // appearing in this report with "No reason provided".
  const notSoldVisitsRaw = [];
  for (const v of visits) {
    const items = itemsMap[v.id] || [];
    const totalSold = items.reduce((s, i) => s + (i.sold || 0), 0);
    if (totalSold > 0) continue;
    const reasonItem = items.find(i => i.not_sold_reason && String(i.not_sold_reason).trim() !== '');
    if (!reasonItem) continue; // skip visits without an explicit not-sold reason
    const rawReason = reasonItem.not_sold_reason;
    const reason = rawReason.toLowerCase() === 'other' ? 'Other (no details provided)' : rawReason;
    notSoldVisitsRaw.push({
      visit_id:          v.id,
      shop_name:         v.shops?.name              || 'Unknown Shop',
      shop_location:     v.shops?.location          || null,
      subregion_name:    v.shops?.subregions?.name  || null,
      region_name:       v.shops?.regions?.name     || null,
      salesperson_name:  v.app_users?.full_name     || 'Unknown',
      visited_at:        v.created_at,
      reason,
      latitude:          v.latitude   ?? null,
      longitude:         v.longitude  ?? null,
      selfie_path:       v.selfie_path || null,
      selfie_url:        null,
    });
  }

  // Pass 2: sign selfie URLs in parallel — skip for large result sets to prevent storage timeouts
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
  const notSoldVisits = notSoldVisitsRaw;

  // ── Build summary metadata ──────────────────────────────────────────────
  const total = notSoldVisits.length;

  // Top reason
  const reasonCounts = {};
  notSoldVisits.forEach(r => { reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1; });
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Most affected region
  const regionCounts = {};
  notSoldVisits.forEach(r => {
    if (r.region_name) regionCounts[r.region_name] = (regionCounts[r.region_name] || 0) + 1;
  });
  const topRegion = Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Top-Reason',  topReason);
  res.setHeader('X-Top-Region',  topRegion);

  return res.status(200).json(notSoldVisits);
}

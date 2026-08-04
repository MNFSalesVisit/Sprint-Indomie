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

function buildDateWindow(dateFrom, dateTo, year, month, filterMode = 'month') {
  if (filterMode === 'range' && (dateFrom || dateTo)) {
    const startDate = parseDateValue(dateFrom, new Date(Date.UTC(2000, 0, 1)));
    const endDate = parseDateValue(dateTo, new Date(Date.UTC(2100, 11, 31)));
    return {
      start: startDate.toISOString(),
      end: new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 59, 59, 999)).toISOString(),
    };
  }

  if (filterMode === 'month' && year && month) {
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
 * Uses server-side RPCs (POST-based) so there are no URL-length limits
 * regardless of how many visits fall in the date range.
 *
 * Response body:
 *   {
 *     total_not_sold_visits: N,
 *     top_reason: string,
 *     top_region: string,
 *     summary_rows: [{ reason, count, rows }],
 *     detail_rows: [{ visit_id, shop_name, ... }]
 *   }
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
    filter_mode,
    page,
    per_page,
  } = req.query;

  // ── Pagination params ───────────────────────────────────────────────────────────
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const itemsPerPage = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));

  const filterMode = filter_mode === 'range' ? 'range' : (date_from || date_to ? 'range' : 'month');

  // ── Build date window (UTC so month boundaries don't shift) ─────────
  const { start, end } = buildDateWindow(date_from, date_to, year, month, filterMode);

  // ── Build effective region scope ──────────────────────────────────────────
  let effectiveRegionIds = null; // null = no restriction (Super Admin)
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

  // ── Build RPC params ───────────────────────────────────────────────────────────────
  // RPC uses HTTP POST with a JSON body — no URL length limits.
  const rpcParams = {
    p_start:        start,
    p_end:          end,
    p_region_ids:   effectiveRegionIds,           // null or int[]
    p_subregion_id: subregion_id ? parseInt(subregion_id, 10) : null,
    p_user_id:      user_id || null,
  };

  // ── Run all three RPC calls in parallel ────────────────────────────────────────────
  const [
    { data: summaryData, error: summaryErr },
    { data: detailData,  error: detailErr  },
    { data: totalData,   error: totalErr   },
  ] = await Promise.all([
    adminSupabase.rpc('get_not_sold_summary', rpcParams),
    adminSupabase.rpc('get_not_sold_detail',  rpcParams),
    adminSupabase.rpc('get_not_sold_total',   rpcParams),
  ]);

  if (summaryErr) return res.status(500).json({ error: summaryErr.message });
  if (detailErr)  return res.status(500).json({ error: detailErr.message  });
  if (totalErr)   return res.status(500).json({ error: totalErr.message   });

  const total = Number(totalData ?? 0);

  // ── Shape detail rows ────────────────────────────────────────────────────────────────────
  const detailRows = (detailData || []).map(row => ({
    visit_id:         row.visit_id,
    shop_name:        row.shop_name        || 'Unknown Shop',
    shop_location:    row.shop_location    || null,
    subregion_name:   row.subregion_name   || null,
    region_name:      row.region_name      || null,
    salesperson_name: row.salesperson_name || 'Unknown',
    visited_at:       row.visited_at,
    reason:           row.reason,
    reason_labels:    row.reason_labels    || [],
    latitude:         row.latitude         ?? null,
    longitude:        row.longitude        ?? null,
    selfie_path:      row.selfie_path      || null,
    selfie_url:       null,
  }));

  // ── Sign selfie URLs (skip for large sets to avoid storage timeout) ─────
  if (detailRows.length <= 80) {
    await Promise.all(
      detailRows
        .filter(entry => entry.selfie_path)
        .map(async entry => {
          const { data: signed } = await adminSupabase.storage
            .from('visit-media')
            .createSignedUrl(entry.selfie_path, 3600);
          entry.selfie_url = signed?.signedUrl || null;
        })
    );
  }

  // ── Build summary rows from RPC summary data ──────────────────────────────────
  const detailByReason = {};
  for (const row of detailRows) {
    for (const label of (row.reason_labels || [])) {
      if (!detailByReason[label]) detailByReason[label] = [];
      detailByReason[label].push(row);
    }
  }

  const reasonSummary = (summaryData || []).map(s => ({
    reason: s.reason,
    count:  Number(s.not_sold_visit_count),
    rows:   detailByReason[s.reason] || [],
  }));

  const topReason = reasonSummary[0]?.reason || '';

  const regionCounts = {};
  detailRows.forEach(r => {
    if (r.region_name) regionCounts[r.region_name] = (regionCounts[r.region_name] || 0) + 1;
  });
  const topRegion = Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Top-Reason',  topReason);
  res.setHeader('X-Top-Region',  topRegion);
  res.setHeader('X-Page',        String(currentPage));
  res.setHeader('X-Per-Page',    String(detailRows.length));
  res.setHeader('X-Total-Pages', String(detailRows.length > 0 ? 1 : 0));

  return res.status(200).json({
    total_not_sold_visits: total,
    top_reason:   topReason,
    top_region:   topRegion,
    summary_rows: reasonSummary,
    detail_rows:  detailRows,
  });
}

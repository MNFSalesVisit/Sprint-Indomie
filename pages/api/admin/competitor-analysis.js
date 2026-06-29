import { adminSupabase, verifyAdminOrManager } from '../../../lib/adminAuth';
import { logApiCall } from '../../../lib/apiLogger';
import { applyLowPriorityThrottle } from '../../../lib/throttle';

// GET /api/admin/competitor-analysis?year=2026&month=3&subregion_id=12&date=2026-03-29&date_from=2026-03-01&date_to=2026-03-31&region_id=1
// returns [{ shop_id, shop_name, brands: ['Nala','Kellogg'], last_seen }]

export default async function handler(req, res) {
  try {
    const actor = await verifyAdminOrManager(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Cache-Control', 'private, no-store');
    logApiCall('/api/admin/competitor-analysis', 'admin');
    await applyLowPriorityThrottle();

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { year, month, subregion_id, date, date_from, date_to, region_id } = req.query || {};

    // ── Resolve effective region scope ────────────────────────────────────────
    // Admin users have allowedRegionIds from their user_regions assignments.
    // Manager + Super Admin have allowedRegionIds = [] meaning "all regions".
    const { allowedRegionIds } = actor;
    let effectiveRegionIds = []; // empty = no restriction

    if (allowedRegionIds.length > 0) {
      // User is scoped to specific regions; intersect with requested region_id if given
      effectiveRegionIds = region_id
        ? allowedRegionIds.filter(id => id === Number(region_id))
        : allowedRegionIds;
      if (effectiveRegionIds.length === 0) return res.status(200).json([]);
    } else if (region_id) {
      // No role restriction but user requested a specific region
      effectiveRegionIds = [Number(region_id)];
    }

    // ── Build base query ──────────────────────────────────────────────────────
    let q = adminSupabase
      .from('visits')
      .select('shop_id, shops(name), competitor_presence, created_at, subregion_id, region_id')
      .not('competitor_presence', 'is', null);

    // Apply resolved region scope
    if (effectiveRegionIds.length > 0) q = q.in('region_id', effectiveRegionIds);

    // Subregion filter
    if (subregion_id) q = q.eq('subregion_id', Number(subregion_id));

    // ── Date filters ──────────────────────────────────────────────────────────
    // Priority: date_from/date_to range > exact date > year+month > year alone
    if (date_from || date_to) {
      if (date_from) q = q.gte('created_at', `${date_from}T00:00:00Z`);
      if (date_to)   q = q.lte('created_at', `${date_to}T23:59:59Z`);
    } else if (date) {
      q = q.gte('created_at', `${date}T00:00:00Z`).lte('created_at', `${date}T23:59:59Z`);
    } else if (year && month) {
      const m  = String(month).padStart(2, '0');
      const mm = parseInt(month, 10);
      let ny = parseInt(year, 10), nm = mm + 1;
      if (nm === 13) { nm = 1; ny += 1; }
      q = q
        .gte('created_at', `${year}-${m}-01T00:00:00Z`)
        .lt('created_at',  `${ny}-${String(nm).padStart(2, '0')}-01T00:00:00Z`);
    } else if (year) {
      q = q
        .gte('created_at', `${year}-01-01T00:00:00Z`)
        .lt('created_at',  `${parseInt(year, 10) + 1}-01-01T00:00:00Z`);
    }
    // NOTE: month-only without year intentionally ignored (ambiguous)

    const { data, error } = await q.order('shop_id', { ascending: true }).limit(10000);
    if (error) return res.status(500).json({ error: error.message });

    // ── Fetch subregion names ─────────────────────────────────────────────────
    const subregionIds = Array.from(new Set((data || []).map(r => r.subregion_id).filter(Boolean)));
    const subregionMap = {};
    if (subregionIds.length > 0) {
      const { data: subs } = await adminSupabase
        .from('subregions')
        .select('id, name')
        .in('id', subregionIds);
      (subs || []).forEach(s => { subregionMap[String(s.id)] = s.name; });
    }

    // ── Aggregate by shop ─────────────────────────────────────────────────────
    const map = new Map();
    for (const r of (data || [])) {
      if (!r.shop_id) continue;
      const sid      = String(r.shop_id);
      const shopName = r.shops?.name || '—';
      const subName  = r.subregion_id ? (subregionMap[String(r.subregion_id)] || null) : null;
      const brandRaw = r.competitor_presence;
      if (!brandRaw) continue;

      const brandList = Array.isArray(brandRaw) ? brandRaw : [String(brandRaw)];
      const entry = map.get(sid) || {
        shop_id: sid, shop_name: shopName, subregion_name: subName,
        brands: new Set(), last_seen: null,
      };
      brandList.forEach(b => {
        const clean = (b || '').toString().trim();
        if (clean && clean.toLowerCase() !== 'none') entry.brands.add(clean);
      });
      const seen = new Date(r.created_at);
      if (!entry.last_seen || seen > entry.last_seen) entry.last_seen = seen;
      if (!entry.subregion_name && subName) entry.subregion_name = subName;
      map.set(sid, entry);
    }

    // Only include shops that actually have competitor brands (not just "none" entries)
    const out = Array.from(map.values())
      .filter(e => e.brands.size > 0)
      .map(e => ({
        shop_id:       e.shop_id,
        shop_name:     e.shop_name,
        subregion_name: e.subregion_name || null,
        brands:        Array.from(e.brands),
        last_seen:     e.last_seen ? e.last_seen.toISOString() : null,
      }));

    // ── Enrich with shop coordinates ──────────────────────────────────────────
    const shopIds = out.map(o => Number(o.shop_id)).filter(Boolean);
    if (shopIds.length > 0) {
      const { data: shopRows } = await adminSupabase
        .from('shops')
        .select('id, latitude, longitude')
        .in('id', shopIds);
      const coordMap = {};
      (shopRows || []).forEach(s => { coordMap[String(s.id)] = { latitude: s.latitude, longitude: s.longitude }; });
      out.forEach(o => {
        const c = coordMap[String(o.shop_id)];
        if (c) { o.latitude = c.latitude; o.longitude = c.longitude; }
      });
    }

    const hasFiltersCA = !!(date || date_from || date_to || (year && month) || year || subregion_id || region_id || effectiveRegionIds.length > 0);
    if (!hasFiltersCA && out.length > 10) {
      res.setHeader('X-Data-Limited', 'true');
      return res.status(200).json(out.slice(0, 10));
    }
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

import { createClient } from '@supabase/supabase-js';
import { getCache, setCache, deleteCache } from '../../../lib/serverCache';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SHOPS_TTL_MS = 2 * 60 * 1000; // 2 minutes — short enough to catch new shops

/* ── duplicate-detection helpers (mirrors shop-duplicate-check.js) ── */
function normalisedJaccard(a, b) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const tokA = new Set(na.split(' ').filter(Boolean));
  const tokB = new Set(nb.split(' ').filter(Boolean));
  const intersection = [...tokA].filter(t => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const containsBonus = na.includes(nb) || nb.includes(na) ? 0.7 : 0;
  return Math.max(jaccard, containsBonus);
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GET /api/sales/shops?subregion_id=X
 * Returns shops in the given subregion (must belong to the salesperson's
 * assigned region). Only accessible by Salesperson role.
 *
 * POST /api/sales/shops
 * Body: { name, location, subregion_id }
 * Registers a new shop under the salesperson's region + chosen subregion.
 */
export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // Verify token
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Look up app_user and confirm Salesperson role
    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, roles(name)')
      .eq('email', user.email)
      .single();

    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
    if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Access denied' });

    // Resolve the salesperson's assigned region
    const { data: regionRows, error: regionErr } = await adminSupabase
      .from('user_regions')
      .select('region_id')
      .eq('user_id', appUser.id)
      .limit(1);

    if (regionErr) return res.status(500).json({ error: regionErr.message });
    const regionId = regionRows?.[0]?.region_id;
    if (!regionId) return res.status(400).json({ error: 'No region assigned to your account' });

    /* ── GET — list shops ── */
    if (req.method === 'GET') {
      const subregionId = req.query.subregion_id ? parseInt(req.query.subregion_id, 10) : null;

      // Cache hit: only cache subregion-filtered requests (the common case)
      if (subregionId) {
        const cacheKey = `shops:sub:${subregionId}`;
        const cached = getCache(cacheKey);
        if (cached) return res.status(200).json(cached);
      }

      let query = adminSupabase
        .from('shops')
        // Include latitude/longitude so frontend can validate proximity
        .select('id, name, location, subregion_id, latitude, longitude')
        .eq('region_id', regionId)
        .order('name');

      if (subregionId) query = query.eq('subregion_id', subregionId);

      const { data: shops, error: shopErr } = await query;
      if (shopErr) return res.status(500).json({ error: shopErr.message });

      // Populate cache for subregion requests
      if (subregionId) setCache(`shops:sub:${subregionId}`, shops ?? [], SHOPS_TTL_MS);

      return res.status(200).json(shops ?? []);
    }

    /* ── POST — register a new shop ── */
    if (req.method === 'POST') {
      const { name, location, subregion_id, latitude, longitude } = req.body || {};
      const trimmedName = (name || '').trim();
      if (!trimmedName) return res.status(400).json({ error: 'Shop name is required' });

      const subId = subregion_id ? parseInt(subregion_id, 10) : null;

      // Verify subregion belongs to the salesperson's region
      if (subId) {
        const { data: sub } = await adminSupabase
          .from('subregions')
          .select('id')
          .eq('id', subId)
          .eq('region_id', regionId)
          .single();
        if (!sub) return res.status(400).json({ error: 'Subregion does not belong to your assigned region' });
      }

      const lat = typeof latitude  === 'number' ? latitude  : null;
      const lng = typeof longitude === 'number' ? longitude : null;

      // ── Hard duplicate guard ──────────────────────────────────────────────
      // Two-tier: shops WITH coords need name ≥ 60% AND distance ≤ 150 m;
      //           shops WITHOUT coords (legacy) need name ≥ 85%.
      const { data: candidateShops } = await adminSupabase
        .from('shops')
        .select('id, name, latitude, longitude')
        .eq('region_id', regionId);

      for (const candidate of candidateShops || []) {
        const nameSim = normalisedJaccard(trimmedName, candidate.name);
        const hasCoords = candidate.latitude != null && candidate.longitude != null;

        if (hasCoords && lat !== null && lng !== null) {
          // Primary gate: distance first, then name
          const distM = haversineM(lat, lng, candidate.latitude, candidate.longitude);
          if (distM > 150) continue;
          if (nameSim < 0.60) continue;
          return res.status(409).json({
            error: `This shop already exists: "${candidate.name}" is ${Math.round(distM)} m away with ${Math.round(nameSim * 100)}% name similarity. Please select it from the existing shops list instead.`,
            existing_shop_id: candidate.id,
          });
        } else if (!hasCoords) {
          // Legacy shop with no stored coordinates — use strict name-only threshold
          if (nameSim >= 0.85) {
            return res.status(409).json({
              error: `This shop already exists: "${candidate.name}" has ${Math.round(nameSim * 100)}% name similarity. Please select it from the existing shops list instead.`,
              existing_shop_id: candidate.id,
            });
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const { data: shop, error: insertErr } = await adminSupabase
        .from('shops')
        .insert({
          name:         trimmedName,
          location:     (location || '').trim() || null,
          region_id:    regionId,
          subregion_id: subId,
          latitude:     lat,
          longitude:    lng,
          created_by:   appUser.id,
        })
        .select('id, name, location, subregion_id, latitude, longitude')
        .single();

      if (insertErr) return res.status(500).json({ error: insertErr.message });

      // Invalidate the shop list cache for this subregion so the next GET is fresh
      if (subId) deleteCache(`shops:sub:${subId}`);

      return res.status(201).json(shop);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

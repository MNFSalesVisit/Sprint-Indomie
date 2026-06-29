import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ── helpers ── */

/** Normalise a name: lowercase, strip non-alphanumeric, collapse whitespace */
function normaliseName(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Combined name similarity score [0–1].
 * Uses Jaccard token overlap + a containment bonus so that
 * "Mama Mboga" still matches "Mama Mboga Store".
 */
function nameSimilarity(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokA = new Set(na.split(' ').filter(Boolean));
  const tokB = new Set(nb.split(' ').filter(Boolean));
  const intersection = [...tokA].filter(t => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  // One name is a substring of the other → strong signal
  const containsBonus = na.includes(nb) || nb.includes(na) ? 0.7 : 0;

  return Math.max(jaccard, containsBonus);
}

/** Haversine distance in metres between two lat/lon pairs */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── thresholds ── */
const NAME_THRESHOLD_STRONG = 0.60; // name check when coords are also available
const NAME_THRESHOLD_LEGACY = 0.85; // stricter name-only check for shops with no stored coords
const DIST_THRESHOLD = 150;         // ≤ 150 m → location match

/**
 * POST /api/sales/shop-duplicate-check
 * Body : { name: string, latitude: number, longitude: number }
 * Returns: { matches: Match[] }
 *
 * Two-tier matching:
 *   • Shops WITH stored coords  → name ≥ 60% AND distance ≤ 150 m  (strong)
 *   • Shops WITHOUT stored coords → name ≥ 85% only (legacy fallback)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    /* ── auth ── */
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, roles(name)')
      .eq('email', user.email)
      .single();
    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
    if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Access denied' });

    /* ── salesperson's region ── */
    const { data: regionRows } = await adminSupabase
      .from('user_regions')
      .select('region_id')
      .eq('user_id', appUser.id)
      .limit(1);

    const regionId = regionRows?.[0]?.region_id;
    if (!regionId) return res.status(400).json({ error: 'No region assigned to your account' });

    /* ── parse input ── */
    const { name, latitude, longitude } = req.body || {};
    const trimmedName = (name || '').trim();
    if (trimmedName.length < 2) return res.status(200).json({ matches: [] });

    const lat = typeof latitude  === 'number' ? latitude  : null;
    const lng = typeof longitude === 'number' ? longitude : null;
    // Both coordinates are mandatory — without them we cannot do a reliable check
    if (lat === null || lng === null) return res.status(200).json({ matches: [] });

    /* ── fetch all shops in this region with subregion info ── */
    const { data: allShops, error: shopErr } = await adminSupabase
      .from('shops')
      .select('id, name, location, subregion_id, latitude, longitude, subregions(name)')
      .eq('region_id', regionId);

    if (shopErr) return res.status(500).json({ error: shopErr.message });

    /* ── score each candidate ── */
    const matches = [];

    for (const shop of allShops || []) {
      const hasCoords = shop.latitude != null && shop.longitude != null;

      if (hasCoords) {
        // Primary gate: distance must be ≤ 150 m first
        const distM = haversineMeters(lat, lng, shop.latitude, shop.longitude);
        if (distM > DIST_THRESHOLD) continue;
        // Secondary gate: name must be ≥ 60% similar
        const nameSim = nameSimilarity(trimmedName, shop.name);
        if (nameSim < NAME_THRESHOLD_STRONG) continue;
        matches.push({
          id:              shop.id,
          name:            shop.name,
          location:        shop.location,
          subregion_id:    shop.subregion_id,
          subregion_name:  shop.subregions?.name ?? null,
          latitude:        shop.latitude,
          longitude:       shop.longitude,
          name_similarity: Math.round(nameSim * 100),
          distance_m:      Math.round(distM),
          match_type:      'strong',
        });
      } else {
        // Legacy fallback: no stored coords — use strict name-only threshold
        const nameSim = nameSimilarity(trimmedName, shop.name);
        if (nameSim < NAME_THRESHOLD_LEGACY) continue;
        matches.push({
          id:              shop.id,
          name:            shop.name,
          location:        shop.location,
          subregion_id:    shop.subregion_id,
          subregion_name:  shop.subregions?.name ?? null,
          latitude:        null,
          longitude:       null,
          name_similarity: Math.round(nameSim * 100),
          distance_m:      null,
          match_type:      'name',
        });
      }
    }

    /* ── sort: strong first, then by distance / name score ── */
    const ORDER = { strong: 0, name: 1, location: 2 };
    matches.sort((a, b) => {
      if (ORDER[a.match_type] !== ORDER[b.match_type])
        return ORDER[a.match_type] - ORDER[b.match_type];
      if (a.distance_m != null && b.distance_m != null)
        return a.distance_m - b.distance_m;
      return b.name_similarity - a.name_similarity;
    });

    return res.status(200).json({ matches: matches.slice(0, 5) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

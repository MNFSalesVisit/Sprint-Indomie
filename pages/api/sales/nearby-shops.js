import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Resolve app_user and region (must be Salesperson)
    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, roles(name)')
      .eq('email', user.email)
      .single();
    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });

    const { data: regionRows } = await adminSupabase
      .from('user_regions')
      .select('region_id')
      .eq('user_id', appUser.id)
      .limit(1);
    const regionId = regionRows?.[0]?.region_id;
    if (!regionId) return res.status(400).json({ error: 'No region assigned to your account' });

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'Missing or invalid lat/lng' });

    // Fetch only shops within a bounding box first (fast SQL-level filter), then apply
    // exact Haversine in JS. 0.005° ≈ 550 m — safely covers the 300 m suggestion radius.
    const NEARBY_RADIUS_M = 300;
    const DEGREE_BUFFER = 0.005;
    const { data: shops, error: shopErr } = await adminSupabase
      .from('shops')
      .select('id, name, location, subregion_id, latitude, longitude')
      .eq('region_id', regionId)
      .gte('latitude',  lat - DEGREE_BUFFER)
      .lte('latitude',  lat + DEGREE_BUFFER)
      .gte('longitude', lng - DEGREE_BUFFER)
      .lte('longitude', lng + DEGREE_BUFFER);
    if (shopErr) return res.status(500).json({ error: shopErr.message });

    const computed = (shops || []).map(s => {
      const hasCoords = s.latitude != null && s.longitude != null;
      const distance_m = hasCoords ? Math.round(haversineM(lat, lng, s.latitude, s.longitude)) : null;
      console.log('api/sales/nearby-shops: shop', s.id, 'distance_m', distance_m);
      return { ...s, distance_m };
    });

    const nearby = computed
      .filter(s => s.distance_m != null && s.distance_m <= NEARBY_RADIUS_M)
      .sort((a,b) => a.distance_m - b.distance_m);

    return res.status(200).json(nearby);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

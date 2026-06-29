import { createClient } from '@supabase/supabase-js';
import { logApiCall } from '../../../lib/apiLogger';
import { osrmRouteDistanceKm, getUserFuelRate, computeTotalDistanceKmForVisits, getGlobalFuelPrice, getFuelPriceForType, safeDiv, DEFAULT_FUEL_TYPES } from '../../../lib/fuel';

const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Ensure user is admin (best-effort check)
    // Support both role name (roles.name) and numeric role_id (legacy setups)
    const { data: appUser } = await adminSupabase
      .from('app_users')
      .select('id, role_id, roles(name)')
      .eq('email', user.email)
      .limit(1)
      .single();
    if (!appUser) return res.status(403).json({ error: 'Insufficient permissions' });

    const roleName = appUser.roles?.name || null;
    const roleId = appUser.role_id || null;
    // Allow if role name is Admin/Super Admin, or role_id matches numeric admin id (commonly 1 or 2)
    const isAdmin = (roleName === 'Admin' || roleName === 'Super Admin') || (roleId && (roleId === 1 || roleId === 2));
    if (!isAdmin) return res.status(403).json({ error: 'Insufficient permissions' });
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    logApiCall('/api/admin/fuel-report', 'admin');

    // Filters
    // Accept either `date=YYYY-MM-DD` OR `year=YYYY&month=M` (1-12)
    const date = req.query.date; // YYYY-MM-DD (optional)
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    const month = req.query.month ? parseInt(req.query.month, 10) : null; // 1-12
    const userId = req.query.user_id;
    const regionId = req.query.region_id ? parseInt(req.query.region_id, 10) : null;

    // Build start/end ISO range
    let startISO = null, endISO = null;
    if (date) {
      const start = new Date(date + 'T00:00:00');
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      startISO = start.toISOString(); endISO = end.toISOString();
    } else if (year && month && month >= 1 && month <= 12) {
      // Use UTC to avoid timezone shifts
      const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      startISO = start.toISOString(); endISO = end.toISOString();
    }

    // Fetch visits grouped by user
    // Ensure we only consider visits with coordinates and apply optional region filter
    let visitsQuery = adminSupabase.from('visits').select('id, user_id, latitude, longitude, created_at, region_id');
    if (startISO && endISO) visitsQuery = visitsQuery.gte('created_at', startISO).lt('created_at', endISO);
    if (userId) visitsQuery = visitsQuery.eq('user_id', userId);
    if (regionId) visitsQuery = visitsQuery.eq('region_id', regionId);
    visitsQuery = visitsQuery.not('latitude', 'is', null).not('longitude', 'is', null);
    const { data: visitsData, error: vErr } = await visitsQuery;
    if (vErr) return res.status(500).json({ error: vErr.message });

    // Group visits by user and date (local date string)
    const byUserDate = {};
    for (const v of visitsData || []) {
      const uid = String(v.user_id);
      const localDate = new Date(v.created_at).toISOString().slice(0,10);
      const key = `${uid}|${localDate}`;
      if (!byUserDate[key]) byUserDate[key] = { user_id: uid, date: localDate, visits: [] };
      byUserDate[key].visits.push(v);
    }

    const fuelPrices = await getGlobalFuelPrice(adminSupabase);

    const results = [];
    for (const k of Object.keys(byUserDate)) {
      const { user_id, date: day, visits } = byUserDate[k];
      // Only calculate between shops (consecutive visits)
      const total_distance_km = await computeTotalDistanceKmForVisits(visits);
      console.log('Distance:', total_distance_km);

      const { user, fuel_rate, vehicle_type, fuel_type } = await getUserFuelRate(adminSupabase, user_id);
      const fuel_rate_used = fuel_rate || null;
      const fuel_type_used = fuel_type || (DEFAULT_FUEL_TYPES[vehicle_type] || 'motorbike');
      const fuel_price_used = (fuelPrices && (fuelPrices[fuel_type_used] || fuelPrices[fuel_type_used] === 0))
        ? fuelPrices[fuel_type_used]
        : await getFuelPriceForType(adminSupabase, fuel_type_used);

      console.log('Fuel Config:', { vehicle_type, fuel_type: fuel_type_used, fuel_rate: fuel_rate_used, fuel_price: fuel_price_used });

      const fuel_used = safeDiv(total_distance_km, fuel_rate_used);
      const fuel_cost = (fuel_used || 0) * (fuel_price_used || 0);
      console.log('Fuel:', fuel_used, fuel_cost);

      // cartons sold: try to sum from visit_items if available (store uses `sold` column)
      let cartons_sold = 0;
      try {
        const visitIds = visits.map(v => v.id);
        console.log('visit count for', user_id, day, visitIds.length);
        if (visitIds.length > 0) {
          const { data: items } = await adminSupabase.from('visit_items').select('sold').in('visit_id', visitIds);
          if (Array.isArray(items)) cartons_sold = items.reduce((s, i) => s + (Number(i.sold) || 0), 0);
        }
      } catch (e) { cartons_sold = 0; }

      const number_of_shops = visits.length;
      const cost_per_km = safeDiv(fuel_cost, total_distance_km);
      const cost_per_visit = safeDiv(fuel_cost, number_of_shops);
      const cost_per_carton = safeDiv(fuel_cost, cartons_sold);

      results.push({
        user_id,
        user_name: user?.full_name || null,
        vehicle_type: vehicle_type || null,
        fuel_type: fuel_type_used,
        fuel_rate_used,
        fuel_price_used: fuel_price_used || null,
        date: day,
        total_distance_km,
        fuel_used,
        fuel_cost,
        cost_per_km,
        cost_per_visit,
        cost_per_carton,
        number_of_shops,
        cartons_sold,
      });
    }

    const hasFilters = !!(date || userId || regionId);
    if (!hasFilters && results.length > 10) {
      res.setHeader('X-Data-Limited', 'true');
      return res.status(200).json(results.slice(0, 10));
    }
    return res.status(200).json(results);
  } catch (err) {
    console.log('api/admin/fuel-report error', err && err.message);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// Default fallbacks
export const DEFAULT_FUEL_RATES = {
  van: 16,
  motorbike: 40,
  tuktuk: 25,
};

export const DEFAULT_FUEL_TYPES = {
  van: 'petrol',
  motorbike: 'diesel',
  tuktuk: 'diesel',
};

// Simple in-memory cache for OSRM segment results for the current process
const osrmCache = new Map();

function osrmKey(lon1, lat1, lon2, lat2) {
  return `${lon1},${lat1}|${lon2},${lat2}`;
}

export async function osrmRouteDistanceKm(lon1, lat1, lon2, lat2) {
  const key = osrmKey(lon1, lat1, lon2, lat2);
  if (osrmCache.has(key)) return osrmCache.get(key);

  const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  try {
    const r = await (globalThis.fetch || fetch)(url, { method: 'GET' });
    if (!r.ok) throw new Error(`OSRM error ${r.status}`);
    const j = await r.json();
    const meters = j?.routes?.[0]?.distance;
    if (typeof meters !== 'number' || !isFinite(meters)) {
      osrmCache.set(key, null);
      return null;
    }
    const km = meters / 1000;
    osrmCache.set(key, km);
    return km;
  } catch (err) {
    // don't crash — log and return null
    console.log('lib/fuel.osrmRouteDistanceKm error', err && err.message);
    osrmCache.set(key, null);
    return null;
  }
}

export async function getUserFuelRate(adminSupabase, userId) {
  try {
    const { data: u, error } = await adminSupabase
      .from('app_users')
      .select('id, full_name, vehicle, fuel_rate_km_per_litre, fuel_type')
      .eq('id', userId)
      .limit(1)
      .single();

    // If user record missing, fall back to sensible defaults rather than returning nulls.
    if (error || !u) {
      const vehicle = 'motorbike';
      let rate = null;
      let fuelType = null;
      try {
        const keys = [
          `fuel_rate_${vehicle}`,
          `fuel_type_${vehicle}`,
        ];
        const { data: cfg } = await adminSupabase.from('system_config').select('key, value').in('key', keys);
        for (const row of cfg || []) {
          if (row.key === `fuel_rate_${vehicle}`) {
            const v = parseFloat(row.value);
            if (isFinite(v)) rate = v;
          }
          if (row.key === `fuel_type_${vehicle}`) {
            fuelType = row.value || null;
          }
        }
      } catch (e) {
        // ignore
      }
      if (!rate) rate = DEFAULT_FUEL_RATES[vehicle] || DEFAULT_FUEL_RATES.motorbike;
      if (!fuelType) fuelType = DEFAULT_FUEL_TYPES[vehicle] || DEFAULT_FUEL_TYPES.motorbike;
      return { user: null, fuel_rate: rate, vehicle_type: vehicle, fuel_type: fuelType };
    }

    const vehicle = u.vehicle || 'motorbike';
    let rate = u.fuel_rate_km_per_litre || null;
    let fuelType = u.fuel_type || null;
    if (!rate) {
      try {
        const keys = {
          van: 'fuel_rate_van',
          motorbike: 'fuel_rate_motorbike',
          tuktuk: 'fuel_rate_tuktuk',
        };
        const key = keys[vehicle] || 'fuel_rate_motorbike';
        const { data: cfg } = await adminSupabase.from('system_config').select('value').eq('key', key).limit(1).single();
        if (cfg && cfg.value) {
          const v = parseFloat(cfg.value);
          if (isFinite(v)) rate = v;
        }
      } catch (e) {
        // ignore and fallback to code defaults
      }
    }
    if (!rate) rate = DEFAULT_FUEL_RATES[vehicle] || DEFAULT_FUEL_RATES.motorbike;
    if (!fuelType) fuelType = DEFAULT_FUEL_TYPES[vehicle] || DEFAULT_FUEL_TYPES.motorbike;
    return { user: u, fuel_rate: rate, vehicle_type: vehicle, fuel_type: fuelType };
  } catch (e) {
    console.log('lib/fuel.getUserFuelRate error', e && e.message);
    // On unexpected error, return safe defaults
    const vehicle = 'motorbike';
    return { user: null, fuel_rate: DEFAULT_FUEL_RATES[vehicle], vehicle_type: vehicle, fuel_type: DEFAULT_FUEL_TYPES[vehicle] };
  }
}

export async function getGlobalFuelPrice(adminSupabase) {
  // Backwards-compat: return petrol price if a single global exists, but prefer explicit per-fuel prices
  try {
    const { data } = await adminSupabase.from('system_config').select('key, value').in('key', ['fuel_price_petrol','fuel_price_diesel']).order('key');
    const cfg = {};
    for (const row of data || []) cfg[row.key] = row.value;
    const petrol = cfg.fuel_price_petrol ? parseFloat(cfg.fuel_price_petrol) : null;
    const diesel = cfg.fuel_price_diesel ? parseFloat(cfg.fuel_price_diesel) : null;
    return { petrol: isFinite(petrol) ? petrol : null, diesel: isFinite(diesel) ? diesel : null };
  } catch (e) {
    // ignore — fallback to env
  }
  const p = parseFloat(process.env.NEXT_PUBLIC_FUEL_PRICE_PETROL || process.env.FUEL_PRICE_PETROL || '0');
  const d = parseFloat(process.env.NEXT_PUBLIC_FUEL_PRICE_DIESEL || process.env.FUEL_PRICE_DIESEL || '0');
  return { petrol: isFinite(p) && p > 0 ? p : null, diesel: isFinite(d) && d > 0 ? d : null };
}

export async function getFuelPriceForType(adminSupabase, type) {
  const prices = await getGlobalFuelPrice(adminSupabase);
  if (!prices) return null;
  return prices[type] || null;
}

// Given an ordered array of visits [{id, latitude, longitude, created_at}], compute total OSRM distance (km)
export async function computeTotalDistanceKmForVisits(visits) {
  if (!Array.isArray(visits) || visits.length < 2) return 0;
  // ensure chronological order
  const sorted = visits.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let total = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) continue;
    const km = await osrmRouteDistanceKm(Number(a.longitude), Number(a.latitude), Number(b.longitude), Number(b.latitude));
    if (km != null && isFinite(km)) total += km;
  }
  return total;
}

export function safeDiv(n, d) { return (!d || d === 0) ? 0 : (n / d); }

import { createClient } from '@supabase/supabase-js';

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

// Manage default fuel rates and fuel types in `system_config` using keys:
//  - fuel_rate_van, fuel_type_van
//  - fuel_rate_motorbike, fuel_type_motorbike
//  - fuel_rate_tuktuk, fuel_type_tuktuk
export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'GET') {
    try {
      const keys = ['fuel_rate_van','fuel_type_van','fuel_rate_motorbike','fuel_type_motorbike','fuel_rate_tuktuk','fuel_type_tuktuk','fuel_price_petrol','fuel_price_diesel'];
      const { data, error } = await adminSupabase
        .from('system_config')
        .select('key, value')
        .in('key', keys)
        .order('key');
      if (error) {
        // if table missing, return empty and client will fallback
        return res.status(200).json({});
      }
      const cfg = {};
      for (const row of data || []) cfg[row.key] = row.value;
      return res.status(200).json(cfg);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    if (admin.role === 'Manager') return res.status(403).json({ error: 'Managers have read-only access to fuel configuration' });
    const body = req.body || {};
    const rows = [];
    const keys = ['fuel_rate_van','fuel_type_van','fuel_rate_motorbike','fuel_type_motorbike','fuel_rate_tuktuk','fuel_type_tuktuk','fuel_price_petrol','fuel_price_diesel'];
    for (const k of keys) {
      if (body[k] != null) {
        rows.push({ key: k, value: String(body[k]), updated_at: new Date().toISOString() });
      }
    }
    if (!rows.length) return res.status(400).json({ error: 'No valid keys provided' });
    try {
      const { error } = await adminSupabase.from('system_config').upsert(rows, { onConflict: 'key' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Allow larger bodies for base64 logo uploads (up to 3 MB)
export const config = {
  api: { bodyParser: { sizeLimit: '3mb' } },
};

async function verifySuperAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return false;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return false;

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role_id')
    .eq('email', data.user.email)
    .limit(1);
  if (!appUser?.length) return false;

  const { data: role } = await supabase
    .from('roles')
    .select('name')
    .eq('id', appUser[0].role_id)
    .limit(1);

  return role?.[0]?.name === 'Super Admin';
}

// Supabase/PostgREST error codes/messages for a missing table
function isTableMissing(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const code = error.code || '';
  return (
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache') ||
    code === 'PGRST200' ||
    code === '42P01'
  );
}

const DEFAULTS = {
  company_name: '',
  company_logo: '',
  contact_email: '',
  contact_phone: '',
  business_address: '',
  system_name: 'Sales Visit System',
  theme_color: '#7c3aed',
  accent_color: '#06b6d4',
};

export default async function handler(req, res) {
  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  // ── GET: return all config as { key: value } ───────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('system_config')
      .select('key, value');

    // Table hasn't been created yet — return defaults so the UI still loads
    if (error && isTableMissing(error)) {
      return res.status(200).json({ ...DEFAULTS, setup_required: true });
    }
    if (error) return res.status(500).json({ error: error.message });

    const cfg = { ...DEFAULTS };
    for (const row of data || []) cfg[row.key] = row.value;
    return res.status(200).json(cfg);
  }

  // ── POST: upsert one or many { key: value } pairs ─────────────────────────
  if (req.method === 'POST') {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return res.status(400).json({ error: 'Invalid body — expected a flat { key: value } object' });

    const ALLOWED_KEYS = new Set([
      'company_name', 'company_logo', 'contact_email',
      'contact_phone', 'business_address',
      'system_name', 'theme_color', 'accent_color',
    ]);

    const rows = Object.entries(body)
      .filter(([k]) => ALLOWED_KEYS.has(k))
      .map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : '',
        updated_at: new Date().toISOString(),
      }));

    if (!rows.length) return res.status(400).json({ error: 'No recognised keys provided' });

    const { error } = await supabase
      .from('system_config')
      .upsert(rows, { onConflict: 'key' });

    if (error && isTableMissing(error)) {
      return res.status(503).json({
        error: 'setup_required',
        detail: 'The system_config table does not exist yet. Run the migration SQL in your Supabase Dashboard → SQL Editor.',
      });
    }
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

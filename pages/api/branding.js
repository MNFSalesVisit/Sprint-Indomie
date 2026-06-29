import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Safe public branding fields — no sensitive data
const SAFE_KEYS = ['company_name', 'company_logo', 'system_name', 'theme_color', 'accent_color', 'contact_email', 'contact_phone', 'business_address'];

const DEFAULTS = {
  company_name:     '',
  company_logo:     '',
  system_name:      'Sales Visit System',
  theme_color:      '#7c3aed',
  accent_color:     '#06b6d4',
  contact_email:    '',
  contact_phone:    '',
  business_address: '',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('key, value')
      .in('key', SAFE_KEYS);

    // Table not yet created → return defaults silently
    if (error) return res.status(200).json(DEFAULTS);

    const out = { ...DEFAULTS };
    for (const row of data || []) {
      if (SAFE_KEYS.includes(row.key)) out[row.key] = row.value;
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch {
    return res.status(200).json(DEFAULTS);
  }
}

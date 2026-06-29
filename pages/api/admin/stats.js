import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    // Roles
    const { data: roles, error: rolesErr } = await supabase.from('roles').select('id,name');
    if (rolesErr) throw rolesErr;

    const totalByRole = [];
    for (const r of roles) {
      const { count, error: cErr } = await supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('role_id', r.id);
      if (cErr) throw cErr;
      totalByRole.push({ role: r.name, count: count || 0 });
    }

    // Active / inactive salespersons
    const salesRole = roles.find(r => r.name.toLowerCase() === 'salesperson');
    let activeSales = 0, inactiveSales = 0;
    if (salesRole) {
      const { count: aCount } = await supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('role_id', salesRole.id).eq('is_active', true);
      const { count: iCount } = await supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('role_id', salesRole.id).eq('is_active', false);
      activeSales = aCount || 0; inactiveSales = iCount || 0;
    }

    // Visits MTD
    const start = new Date();
    start.setDate(1);
    start.setHours(0,0,0,0);
    const isoStart = start.toISOString();
    const { count: visitsCount } = await supabase.from('visits').select('id', { count: 'exact', head: true }).gte('created_at', isoStart);

    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    res.status(200).json({ totalByRole, activeSales, inactiveSales, visitsMTD: visitsCount || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

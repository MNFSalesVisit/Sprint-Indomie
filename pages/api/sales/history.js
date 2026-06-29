import { createClient } from '@supabase/supabase-js';
import { logApiCall } from '../../../lib/apiLogger';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: appUser, error: roleErr } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (roleErr || !appUser) return res.status(403).json({ error: 'User not found' });
  if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  logApiCall('/api/sales/history', 'salesperson');

  // Date ranges
  const now = new Date();
  const mtdStart   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // Fetch uplifts MTD — base columns always present
  const { data: upliftsBase, error: upliftErr } = await adminSupabase
    .from('uplifts')
    .select(`
      id, status, created_at, approved_at, rejected_reason,
      shops!inner(name),
      uplift_items(cartons, products(sku, name))
    `)
    .eq('user_id', appUser.id)
    .gte('created_at', mtdStart)
    .order('created_at', { ascending: false });

  if (upliftErr) return res.status(500).json({ error: upliftErr.message });

  // Try to fetch reupload columns (added by migration 006 — may not exist yet)
  let reuploadMap = {};
  try {
    const { data: reuploadRows } = await adminSupabase
      .from('uplifts')
      .select('id, is_reuploaded, reupload_count')
      .eq('user_id', appUser.id)
      .gte('created_at', mtdStart);
    (reuploadRows || []).forEach(r => { reuploadMap[r.id] = r; });
  } catch (_) { /* migration not yet applied — reupload fields will be undefined */ }

  const uplifts = (upliftsBase || []).map(u => ({
    ...u,
    is_reuploaded:  reuploadMap[u.id]?.is_reuploaded  ?? false,
    reupload_count: reuploadMap[u.id]?.reupload_count  ?? 0,
  }));

  // Fetch visits — today only
  const { data: visits, error: visitErr } = await adminSupabase
    .from('visits')
    .select(`
      id, visit_type, created_at,
      shops!inner(name),
      visit_items(sold, stock_position, products(sku, name))
    `)
    .eq('user_id', appUser.id)
    .gte('created_at', todayStart)
    .order('created_at', { ascending: false });

  if (visitErr) return res.status(500).json({ error: visitErr.message });

  return res.status(200).json({ uplifts, visits });
}

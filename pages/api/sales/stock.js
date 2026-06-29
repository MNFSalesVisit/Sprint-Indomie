import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: appUser, error: userErr } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
  if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');

  const { data, error } = await adminSupabase
    .from('stock_balances')
    .select('quantity, product_id, products(id, sku, name, is_active, sort_order)')
    .eq('user_id', appUser.id);

  if (error) return res.status(500).json({ error: error.message });

  const items = (data || [])
    .map(row => ({
      product_id: row.product_id,
      sku:        row.products?.sku,
      name:       row.products?.name,
      is_active:  row.products?.is_active,
      sort_order: row.products?.sort_order ?? 0,
      quantity:   Math.max(0, row.quantity ?? 0),
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.product_id - b.product_id);

  return res.status(200).json(items);
}

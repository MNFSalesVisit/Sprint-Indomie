import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/sales/products
 * Returns all active products/SKUs ordered by sort_order. Only accessible by Salesperson role.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const { data: appUser, error: userErr } = await adminSupabase
      .from('app_users')
      .select('id, roles(name)')
      .eq('email', user.email)
      .single();

    if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
    if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Access denied' });

    const { data: products, error: prodErr } = await adminSupabase
      .from('products')
      .select('id, sku, name, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order', { nullsFirst: false })
      .order('id');

    if (prodErr) return res.status(500).json({ error: prodErr.message });

    // No CDN caching — product list must always reflect the latest admin config.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(products ?? []);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

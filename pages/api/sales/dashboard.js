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

  const userId = appUser.id;

  // MTD window
  const mtdStart = new Date();
  mtdStart.setDate(1);
  mtdStart.setHours(0, 0, 0, 0);
  const isoStart = mtdStart.toISOString();

  try {
    // ── MTD visits (sales type only) ────────────────────────────────────────────
    const { data: mtdVisits, error: visitsErr } = await adminSupabase
      .from('visits')
      .select('id')
      .eq('user_id', userId)
      .eq('visit_type', 'sales')
      .gte('created_at', isoStart);
    if (visitsErr) throw visitsErr;

    const visitsMTD = mtdVisits?.length ?? 0;
    const visitIds  = (mtdVisits || []).map(v => v.id);

    // ── Converted visits: visits that have at least one item with sold > 0 ─────
    let convertedMTD = 0;
    if (visitIds.length > 0) {
      const { data: soldItems, error: soldErr } = await adminSupabase
        .from('visit_items')
        .select('visit_id')
        .in('visit_id', visitIds)
        .gt('sold', 0);
      if (soldErr) throw soldErr;

      // Count distinct visit_ids
      const uniqueConverted = new Set((soldItems || []).map(r => r.visit_id));
      convertedMTD = uniqueConverted.size;
    }

    const conversionPct = visitsMTD > 0
      ? Math.round((convertedMTD / visitsMTD) * 100)
      : null;

    // ── Pending uplifts ─────────────────────────────────────────────────────────
    const { count: pendingUplifts, error: upliftErr } = await adminSupabase
      .from('uplifts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (upliftErr) throw upliftErr;

    // ── Stock balances ──────────────────────────────────────────────────────────
    const { data: stock, error: stockErr } = await adminSupabase
      .from('stock_balances')
      .select('quantity, products(id, sku, name, sort_order)')
      .eq('user_id', userId);
    if (stockErr) throw stockErr;

    const stockItems = (stock || [])
      .map(s => ({
        product_id:   s.products?.id,
        sku:          s.products?.sku,
        name:         s.products?.name,
        sort_order:   s.products?.sort_order ?? 0,
        quantity:     s.quantity ?? 0,
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.product_id - b.product_id);

    const totalStock = stockItems.reduce((sum, s) => sum + s.quantity, 0);

    return res.status(200).json({
      visitsMTD,
      convertedMTD,
      conversionPct,
      pendingUplifts: pendingUplifts ?? 0,
      totalStock,
      stockItems,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load dashboard stats' });
  }
}

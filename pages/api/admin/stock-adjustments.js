import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verifySuperAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('id, full_name, roles(name)')
    .eq('email', data.user.email)
    .single();
  if (appUser?.roles?.name !== 'Super Admin') return null;
  return { id: appUser.id, full_name: appUser.full_name };
}

export default async function handler(req, res) {
  const actor = await verifySuperAdmin(req);
  if (!actor) return res.status(403).json({ error: 'Forbidden' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { action, user_id, region_id } = req.query;

    // ── List of salespersons with stock summary ──────────────────────────
    if (action === 'users' || !action) {
      const { data: roleRow } = await adminSupabase
        .from('roles').select('id').eq('name', 'Salesperson').single();
      if (!roleRow) return res.status(200).json([]);

      let usersQ = adminSupabase
        .from('app_users')
        .select('id, full_name, email, avatar_url, is_active, user_regions(region_id, regions(id, name))')
        .eq('role_id', roleRow.id)
        .order('full_name');

      if (region_id) {
        const { data: regionUsers } = await adminSupabase
          .from('user_regions').select('user_id').eq('region_id', parseInt(region_id));
        const ids = (regionUsers || []).map(r => r.user_id);
        if (ids.length === 0) return res.status(200).json([]);
        usersQ = usersQ.in('id', ids);
      }

      const { data: users, error: uErr } = await usersQ;
      if (uErr) return res.status(500).json({ error: uErr.message });

      // Attach total stock and SKU count per user
      const userIds = (users || []).map(u => u.id);
      let stockMap = {};
      if (userIds.length > 0) {
        const { data: allStock } = await adminSupabase
          .from('stock_balances')
          .select('user_id, quantity')
          .in('user_id', userIds);
        for (const row of allStock || []) {
          if (!stockMap[row.user_id]) stockMap[row.user_id] = { total: 0, skus: 0 };
          stockMap[row.user_id].total += (row.quantity || 0);
          stockMap[row.user_id].skus  += 1;
        }
      }

      const result = (users || []).map(u => ({
        ...u,
        total_stock: stockMap[u.id]?.total ?? 0,
        sku_count:   stockMap[u.id]?.skus  ?? 0,
      }));
      return res.status(200).json(result);
    }

    // ── Stock balances for a single user ────────────────────────────────
    if (action === 'stock') {
      if (!user_id) return res.status(400).json({ error: 'user_id required' });

      // All active products ordered by sort_order
      const { data: products, error: pErr } = await adminSupabase
        .from('products')
        .select('id, sku, name, is_active, sort_order')
        .order('sort_order')
        .order('id');
      if (pErr) return res.status(500).json({ error: pErr.message });

      // Existing balances for this user
      const { data: balances } = await adminSupabase
        .from('stock_balances')
        .select('id, product_id, quantity, last_updated')
        .eq('user_id', user_id);

      const balMap = {};
      for (const b of balances || []) balMap[b.product_id] = b;

      const result = (products || []).map(p => ({
        product_id:   p.id,
        sku:          p.sku,
        name:         p.name,
        is_active:    p.is_active,
        balance_id:   balMap[p.id]?.id          ?? null,
        quantity:     balMap[p.id]?.quantity     ?? 0,
        last_updated: balMap[p.id]?.last_updated ?? null,
      }));

      return res.status(200).json(result);
    }

    // ── Regions list for filter ──────────────────────────────────────────
    if (action === 'regions') {
      const { data, error } = await adminSupabase
        .from('regions').select('id, name').order('name');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── POST — apply adjustments ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { user_id, adjustments, reason } = req.body;
    // adjustments: [{ product_id, new_quantity, old_quantity }]

    if (!user_id || !Array.isArray(adjustments) || adjustments.length === 0) {
      return res.status(400).json({ error: 'user_id and adjustments[] required' });
    }

    const now = new Date().toISOString();
    const errors = [];
    const applied = [];

    for (const adj of adjustments) {
      const { product_id, new_quantity } = adj;
      if (product_id == null || new_quantity == null) continue;
      const qty = Math.max(0, parseInt(new_quantity, 10));

      const { error } = await adminSupabase
        .from('stock_balances')
        .upsert(
          { user_id, product_id: parseInt(product_id), quantity: qty, last_updated: now },
          { onConflict: 'user_id,product_id' },
        );

      if (error) {
        errors.push({ product_id, error: error.message });
      } else {
        applied.push({ product_id, old: adj.old_quantity, new: qty });
      }
    }

    // Write audit log entry
    if (applied.length > 0) {
      await adminSupabase.from('audit_logs').insert({
        actor_id:  actor.id,
        action:    'stock_adjustment',
        entity:    'stock_balances',
        entity_id: user_id,
        details:   { adjustments: applied, reason: reason || null },
      });
    }

    return res.status(200).json({ ok: true, applied: applied.length, errors });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
